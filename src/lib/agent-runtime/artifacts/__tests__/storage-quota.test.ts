import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { InMemoryQuotaRepository } from "../../quotas/memory";
import { QuotaService } from "../../quotas/service";
import type { CreateQuotaPolicyRevisionInput } from "../../quotas/types";
import { createArtifactRegistrations } from "../capabilities";
import { AesGcmArtifactCursorCodec } from "../cursor";
import {
  InMemoryArtifactContentStore,
  InMemoryArtifactMediaInspector,
  InMemoryArtifactRepository,
} from "../memory";
import {
  ArtifactService,
  type CommitGeneratedArtifactInput,
} from "../service";

const now = new Date("2026-08-01T12:00:00.000Z");

function digest(bytes: Uint8Array): string {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function storagePolicy(hardLimit: string): CreateQuotaPolicyRevisionInput {
  return {
    workspaceId: "workspace_1",
    principalId: null,
    kind: "storage",
    boundary: "artifact_storage",
    dimension: "runtime.artifact_bytes@1",
    unit: "byte",
    window: "lifetime",
    timezone: "UTC",
    reservationRule: "release_on_transition",
    warningThreshold: hardLimit,
    hardLimit,
    exhaustionBehavior: "deny",
    actorUserId: "user_1",
    idempotencyKey: `artifact_storage_${hardLimit}`,
    recordedAt: now,
  };
}

async function fixture(hardLimit: string) {
  const quotaRepository = new InMemoryQuotaRepository();
  const quotas = new QuotaService(quotaRepository);
  await quotas.createPolicyRevision(storagePolicy(hardLimit));
  const repository = new InMemoryArtifactRepository(quotaRepository);
  const store = new InMemoryArtifactContentStore();
  const inspector = new InMemoryArtifactMediaInspector();
  const cursor = new AesGcmArtifactCursorCodec(() => ({
    active: { id: "test-current", key: Buffer.alloc(32, 7) },
    all: [{ id: "test-current", key: Buffer.alloc(32, 7) }],
  }));
  const service = new ArtifactService(
    repository,
    store,
    inspector,
    cursor,
    { now: () => now },
    quotas,
  );
  return { quotaRepository, quotas, repository, store, service };
}

function generatedTextInput(text = "generated"): CommitGeneratedArtifactInput {
  const bytes = Buffer.from(text, "utf8");
  return {
    workspaceId: "workspace_1",
    creatorPrincipalId: "principal_1",
    effectKey: "effect-generated-0001",
    outputName: "text",
    content: {
      kind: "text",
      text,
      mediaType: "text/plain; charset=utf-8",
      digest: digest(bytes),
      sizeBytes: bytes.byteLength,
    },
    origin: {
      workflowId: "workflow_1",
      workflowRevisionId: "revision_1",
      workflowRevision: 1,
      definitionDigest: `sha256:${"1".repeat(64)}`,
      runId: "run_real_1",
      runStartSnapshotDigest: `sha256:${"2".repeat(64)}`,
      stepAttemptId: "attempt_1",
      stepId: "step_1",
      attempt: 1,
      provider: "conformance",
      operationIdentity: "conformance.generate@1",
      providerOperation: "generate",
      providerOperationRef: "conformance:generate:v1",
      model: "fixture-v1",
      intentDigest: `sha256:${"3".repeat(64)}`,
    },
    lineageInputs: [],
  };
}

describe("Artifact storage quota wiring", () => {
  it("publishes a non-retryable Artifact quota error contract", async () => {
    const value = await fixture("10");
    const registrations = createArtifactRegistrations(value.service);
    for (const definition of registrations.filter((item) =>
      ["artifacts.import", "artifact_uploads.complete"].includes(
        item.identity.name,
      ),
    )) {
      expect(definition.errors).toContainEqual({
        code: "ARTIFACT_QUOTA_EXCEEDED",
        category: "authorization",
        retryable: false,
        description:
          "The Artifact exceeds an applicable non-monetary storage Quota Policy.",
      });
    }
  });

  it("accepts the exact byte limit and canonically settles retained storage", async () => {
    const value = await fixture("10");
    const artifact = await value.service.importText({
      workspaceId: "workspace_1",
      principalId: "principal_1",
      idempotencyKey: "exact-limit-0001",
      text: "0123456789",
    });

    expect(artifact.sizeBytes).toBe(10);
    expect([...value.quotaRepository.reservations.values()]).toEqual([
      expect.objectContaining({
        runId: null,
        subject: { kind: "artifact", id: artifact.id },
        dimension: "runtime.artifact_bytes@1",
        unit: "byte",
        reservedAmount: "10",
        heldAmount: "0",
        settledAmount: "10",
        state: "settled",
      }),
    ]);
  });

  it("publishes over-limit denial without accepting Artifact, receipt, or audit evidence", async () => {
    const value = await fixture("4");
    await expect(value.service.importText({
      workspaceId: "workspace_1",
      principalId: "principal_1",
      idempotencyKey: "over-limit-0001",
      text: "12345",
    })).rejects.toMatchObject({
      code: "ARTIFACT_QUOTA_EXCEEDED",
      retryable: false,
      details: {
        reasonCodes: ["QUOTA_CAPACITY_EXHAUSTED"],
        evidence: [expect.objectContaining({
          dimension: "runtime.artifact_bytes@1",
          requested: "5",
          available: "4",
        })],
      },
    });
    expect(value.repository.artifacts.size).toBe(0);
    expect(value.repository.receipts.size).toBe(0);
    expect(value.repository.auditEvents).toHaveLength(0);
    expect(value.quotaRepository.reservations.size).toBe(0);
  });

  it("serializes concurrent imports so they cannot oversubscribe storage", async () => {
    const value = await fixture("10");
    const results = await Promise.allSettled([
      value.service.importText({
        workspaceId: "workspace_1",
        principalId: "principal_1",
        idempotencyKey: "concurrent-a-0001",
        text: "123456",
      }),
      value.service.importText({
        workspaceId: "workspace_1",
        principalId: "principal_1",
        idempotencyKey: "concurrent-b-0001",
        text: "abcdef",
      }),
    ]);

    expect(results.filter((item) => item.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((item) => item.status === "rejected")).toHaveLength(1);
    expect(value.repository.artifacts.size).toBe(1);
    expect(value.repository.receipts.size).toBe(1);
    expect([...value.quotaRepository.reservations.values()]).toEqual([
      expect.objectContaining({ settledAmount: "6", state: "settled" }),
    ]);
  });

  it("binds generated Artifact storage to the real originating Run", async () => {
    const value = await fixture("100");
    const artifact = await value.service.commitGenerated(generatedTextInput());
    expect([...value.quotaRepository.reservations.values()]).toEqual([
      expect.objectContaining({
        runId: "run_real_1",
        subject: { kind: "artifact", id: artifact.id },
        settledAmount: "9",
      }),
    ]);
  });

  it("claims uploaded image bytes without fabricating Run ownership", async () => {
    const value = await fixture("5");
    const bytes = Buffer.from("image");
    const upload = await value.service.beginImageUpload({
      workspaceId: "workspace_1",
      principalId: "principal_1",
      idempotencyKey: "quota-upload-begin-0001",
      mediaType: "image/png",
      expectedDigest: digest(bytes),
      expectedSizeBytes: bytes.byteLength,
    });
    const uploadRecord = value.repository.uploads.get(upload.uploadId)!;
    value.store.seedStaged(uploadRecord.stagingKey, bytes, "image/png");

    const artifact = await value.service.completeImageUpload({
      workspaceId: "workspace_1",
      principalId: "principal_1",
      idempotencyKey: "quota-upload-complete-0001",
      uploadId: upload.uploadId,
    });
    expect([...value.quotaRepository.reservations.values()]).toEqual([
      expect.objectContaining({
        runId: null,
        subject: { kind: "artifact", id: artifact.id },
        settledAmount: "5",
      }),
    ]);
  });

  it("replays one canonical Artifact and one storage reservation", async () => {
    const value = await fixture("100");
    const request = {
      workspaceId: "workspace_1",
      principalId: "principal_1",
      idempotencyKey: "replay-import-0001",
      text: "retry-safe",
    };
    const first = await value.service.importText(request);
    const replay = await value.service.importText(structuredClone(request));

    expect(replay.id).toBe(first.id);
    expect(value.repository.artifacts.size).toBe(1);
    expect(value.repository.receipts.size).toBe(1);
    expect(value.quotaRepository.reservations.size).toBe(1);
  });

  it("does not leak storage quota when the in-memory canonical commit fails", async () => {
    const value = await fixture("100");
    value.repository.failNextCommit = true;
    const request = {
      workspaceId: "workspace_1",
      principalId: "principal_1",
      idempotencyKey: "failed-import-0001",
      text: "try-again",
    };
    await expect(value.service.importText(request)).rejects.toMatchObject({
      code: "ARTIFACT_CONTENT_STORE_UNAVAILABLE",
    });
    expect(value.quotaRepository.reservations.size).toBe(0);
    expect(value.repository.artifacts.size).toBe(0);
    expect(value.repository.receipts.size).toBe(0);

    await expect(value.service.importText(request)).resolves.toMatchObject({
      sizeBytes: 9,
    });
    expect(value.quotaRepository.reservations.size).toBe(1);
  });
});
