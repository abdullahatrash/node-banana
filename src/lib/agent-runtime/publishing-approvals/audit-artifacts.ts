import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { artifactContents, artifacts } from "@/lib/db/schema";
import { S3ArtifactContentStore } from "../artifacts/storage";
import type { ArtifactContentStore } from "../artifacts/types";
import { normalizeArtifactMediaType } from "../artifacts/validation";

export interface PublishingApprovalArtifactEvidence {
  id: string;
  digest: string;
  snapshotDigest: string;
  kind: "text" | "image";
  mediaType: string;
  sizeBytes: number;
}

export interface RetainedPublishingApprovalArtifact {
  digest: string;
  kind: "text" | "image";
  mediaType: string;
  sizeBytes: number;
  textContent: string | null;
}

/** Reads immutable content by validation-bound identity, independent of live Artifact state. */
export class PublishingApprovalAuditArtifactStore {
  constructor(
    private readonly getDatabase: () => ReturnType<typeof getDb> = getDb,
    private readonly contentStore: ArtifactContentStore =
      new S3ArtifactContentStore(),
  ) {}

  private async findContent(input: {
    workspaceId: string;
    evidence: PublishingApprovalArtifactEvidence;
  }) {
    const [row] = await this.getDatabase()
      .select({
        digest: artifactContents.digest,
        kind: artifactContents.kind,
        mediaType: artifactContents.mediaType,
        sizeBytes: artifactContents.sizeBytes,
        inlineText: artifactContents.inlineText,
        storageKey: artifactContents.storageKey,
      })
      .from(artifacts)
      .innerJoin(
        artifactContents,
        and(
          eq(artifactContents.workspaceId, artifacts.workspaceId),
          eq(artifactContents.digest, artifacts.contentDigest),
        ),
      )
      .where(
        and(
          eq(artifacts.workspaceId, input.workspaceId),
          eq(artifacts.id, input.evidence.id),
          // Deliberately no artifacts.deletedAt predicate: the immutable
          // content remains auditable after a live Artifact soft-delete.
          eq(artifactContents.digest, input.evidence.digest),
          eq(artifactContents.kind, input.evidence.kind),
          eq(artifactContents.mediaType, input.evidence.mediaType),
          eq(artifactContents.sizeBytes, input.evidence.sizeBytes),
        ),
      )
      .limit(1);
    return row ?? null;
  }

  async getRetainedArtifact(input: {
    workspaceId: string;
    evidence: PublishingApprovalArtifactEvidence;
  }): Promise<RetainedPublishingApprovalArtifact | null> {
    const row = await this.findContent(input);
    if (!row || (row.kind !== "text" && row.kind !== "image")) return null;
    return {
      digest: row.digest,
      kind: row.kind,
      mediaType: row.mediaType,
      sizeBytes: row.sizeBytes,
      textContent: row.kind === "text" ? row.inlineText : null,
    };
  }

  async readRetainedBytes(input: {
    workspaceId: string;
    evidence: PublishingApprovalArtifactEvidence;
  }): Promise<Uint8Array> {
    const row = await this.findContent(input);
    if (!row || row.kind !== "image" || !row.storageKey) {
      throw new Error("Approval media is unavailable.");
    }
    const snapshot = await this.contentStore.readContent({
      storageKey: row.storageKey,
    });
    const chunks: Uint8Array[] = [];
    let size = 0;
    for await (const chunk of snapshot.chunks) {
      size += chunk.byteLength;
      if (size > input.evidence.sizeBytes) {
        throw new Error("Approval media integrity check failed.");
      }
      chunks.push(Uint8Array.from(chunk));
    }
    const bytes = Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)));
    const digest = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
    if (
      size !== input.evidence.sizeBytes ||
      digest !== input.evidence.digest ||
      normalizeArtifactMediaType(snapshot.mediaType ?? "") !==
        input.evidence.mediaType
    ) {
      throw new Error("Approval media integrity check failed.");
    }
    return Uint8Array.from(bytes);
  }
}

export const PRODUCTION_PUBLISHING_APPROVAL_AUDIT_ARTIFACTS =
  new PublishingApprovalAuditArtifactStore();
