import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { ArtifactContentStore } from "../../artifacts/types";
import {
  PublishingApprovalAuditArtifactStore,
  type PublishingApprovalArtifactEvidence,
} from "../audit-artifacts";

function digest(bytes: Uint8Array): string {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function database(row: Record<string, unknown> | null) {
  return {
    select: () => ({
      from: () => ({
        innerJoin: () => ({
          where: () => ({ limit: async () => (row ? [row] : []) }),
        }),
      }),
    }),
  };
}

function contentStore(bytes: Uint8Array, mediaType = "image/png") {
  return {
    readContent: async () => ({
      chunks: (async function* () {
        yield bytes;
      })(),
      mediaType,
    }),
  } as Pick<ArtifactContentStore, "readContent"> as ArtifactContentStore;
}

describe("PublishingApprovalAuditArtifactStore", () => {
  it("reads retained text through the exact Artifact-to-content join", async () => {
    const bytes = new TextEncoder().encode("Exact historical copy");
    const evidence: PublishingApprovalArtifactEvidence = {
      id: "artifact_text",
      digest: digest(bytes),
      snapshotDigest: `sha256:${"a".repeat(64)}`,
      kind: "text",
      mediaType: "text/plain; charset=utf-8",
      sizeBytes: bytes.byteLength,
    };
    const store = new PublishingApprovalAuditArtifactStore(
      () =>
        database({
          ...evidence,
          inlineText: "Exact historical copy",
          storageKey: null,
        }) as never,
      contentStore(new Uint8Array()),
    );

    await expect(
      store.getRetainedArtifact({ workspaceId: "workspace_1", evidence }),
    ).resolves.toMatchObject({
      digest: evidence.digest,
      kind: "text",
      textContent: "Exact historical copy",
    });
  });

  it("streams retained soft-deleted media only after size, digest, and MIME checks", async () => {
    const bytes = new Uint8Array([1, 2, 3]);
    const evidence: PublishingApprovalArtifactEvidence = {
      id: "artifact_image",
      digest: digest(bytes),
      snapshotDigest: `sha256:${"b".repeat(64)}`,
      kind: "image",
      mediaType: "image/png",
      sizeBytes: bytes.byteLength,
    };
    const row = {
      ...evidence,
      inlineText: null,
      storageKey: "agent-artifacts/content/retained",
    };
    const store = new PublishingApprovalAuditArtifactStore(
      () => database(row) as never,
      contentStore(bytes),
    );

    await expect(
      store.readRetainedBytes({ workspaceId: "workspace_1", evidence }),
    ).resolves.toEqual(bytes);

    const corrupt = new PublishingApprovalAuditArtifactStore(
      () => database(row) as never,
      contentStore(new Uint8Array([9, 9, 9])),
    );
    await expect(
      corrupt.readRetainedBytes({ workspaceId: "workspace_1", evidence }),
    ).rejects.toThrow("integrity check failed");
  });

  it("does not require a live deletedAt-null row or select provenance", () => {
    const source = readFileSync(
      `${process.cwd()}/src/lib/agent-runtime/publishing-approvals/audit-artifacts.ts`,
      "utf8",
    );
    expect(source).toContain("eq(artifacts.id, input.evidence.id)");
    expect(source).not.toContain("isNull(artifacts.deletedAt)");
    expect(source).not.toMatch(/generatedOrigin|lineage|providerOperationRef/);
  });
});
