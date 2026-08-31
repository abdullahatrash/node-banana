import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { AesGcmArtifactCursorCodec } from "../cursor";
import {
  InMemoryArtifactContentStore,
  InMemoryArtifactMediaInspector,
  InMemoryArtifactRepository,
} from "../memory";
import {
  ArtifactService,
  ArtifactServiceError,
} from "../service";

const now = new Date("2026-07-25T01:00:00.000Z");

function sha256(bytes: Uint8Array): string {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function fixture() {
  const repository = new InMemoryArtifactRepository();
  const store = new InMemoryArtifactContentStore();
  const inspector = new InMemoryArtifactMediaInspector();
  const cursor = new AesGcmArtifactCursorCodec(() => ({
    active: { id: "test-current", key: Buffer.alloc(32, 7) },
    all: [
      { id: "test-current", key: Buffer.alloc(32, 7) },
      { id: "test-old", key: Buffer.alloc(32, 6) },
    ],
  }));
  const service = new ArtifactService(
    repository,
    store,
    inspector,
    cursor,
    { now: () => now },
  );
  return { repository, store, inspector, cursor, service };
}

async function beginAndSeed(
  value: ReturnType<typeof fixture>,
  input: {
    idempotencyKey: string;
    bytes: Uint8Array;
    mediaType?: string;
    expectedDigest?: string;
    expectedSizeBytes?: number;
  },
) {
  const upload = await value.service.beginImageUpload({
    workspaceId: "workspace-1",
    principalId: "principal-1",
    idempotencyKey: input.idempotencyKey,
    mediaType: input.mediaType ?? "image/png",
    expectedDigest: input.expectedDigest,
    expectedSizeBytes: input.expectedSizeBytes ?? input.bytes.byteLength,
  });
  const record = value.repository.uploads.get(upload.uploadId)!;
  value.store.seedStaged(
    record.stagingKey,
    input.bytes,
    input.mediaType ?? "image/png",
  );
  return upload;
}

describe("ArtifactService", () => {
  it("imports exact UTF-8 text with verified metadata, retention, creator, and no fake lineage", async () => {
    const value = fixture();
    const bytes = Buffer.from("hello π", "utf8");
    const artifact = await value.service.importText({
      workspaceId: "workspace-1",
      principalId: "principal-1",
      idempotencyKey: "text-import-0001",
      text: "hello π",
      expectedDigest: sha256(bytes),
      expectedSizeBytes: bytes.length,
    });

    expect(artifact).toMatchObject({
      workspaceId: "workspace-1",
      kind: "text",
      digest: sha256(bytes),
      sizeBytes: bytes.length,
      mediaType: "text/plain; charset=utf-8",
      creatorPrincipalId: "principal-1",
      origin: { kind: "imported", importedAt: now.toISOString() },
      retention: {
        mode: "workspace_default",
        snapshotAt: now.toISOString(),
      },
      lineage: { sourceArtifactIds: [] },
    });
    expect(JSON.stringify(artifact)).not.toContain("storageKey");
    expect(JSON.stringify(artifact)).not.toContain("Url");
    await expect(
      value.service.getArtifact({
        workspaceId: "workspace-1",
        artifactId: artifact.id,
      }),
    ).resolves.toMatchObject({ textContent: "hello π" });
  });

  it("rejects text digest, size, and media mismatches without partial state", async () => {
    for (const invalid of [
      { expectedDigest: `sha256:${"0".repeat(64)}` },
      { expectedSizeBytes: 999 },
      { mediaType: "text/html" },
    ]) {
      const value = fixture();
      await expect(
        value.service.importText({
          workspaceId: "workspace-1",
          principalId: "principal-1",
          idempotencyKey: "text-mismatch-1",
          text: "hello",
          ...invalid,
        }),
      ).rejects.toMatchObject({
        code: "ARTIFACT_CONTENT_MISMATCH",
      });
      expect(value.repository.artifacts.size).toBe(0);
      expect(value.repository.contents.size).toBe(0);
      expect(value.repository.receipts.size).toBe(0);
    }
  });

  it("replays one idempotent import but keeps distinct Artifact identities for duplicate content", async () => {
    const value = fixture();
    const first = await value.service.importText({
      workspaceId: "workspace-1",
      principalId: "principal-1",
      idempotencyKey: "text-duplicate-1",
      text: "same bytes",
    });
    const replay = await value.service.importText({
      workspaceId: "workspace-1",
      principalId: "principal-1",
      idempotencyKey: "text-duplicate-1",
      text: "same bytes",
    });
    const second = await value.service.importText({
      workspaceId: "workspace-1",
      principalId: "principal-1",
      idempotencyKey: "text-duplicate-2",
      text: "same bytes",
    });

    expect(replay.id).toBe(first.id);
    expect(second.id).not.toBe(first.id);
    expect(second.digest).toBe(first.digest);
    expect(value.repository.artifacts.size).toBe(2);
    expect(value.repository.contents.size).toBe(1);
    await expect(
      value.service.importText({
        workspaceId: "workspace-1",
        principalId: "principal-1",
        idempotencyKey: "text-duplicate-1",
        text: "different",
      }),
    ).rejects.toMatchObject({
      code: "ARTIFACT_IDEMPOTENCY_CONFLICT",
    });
  });

  it("completes a Principal-bound image upload after exact hash, size, and media inspection", async () => {
    const value = fixture();
    const bytes = Buffer.from("fake-image-bytes");
    const upload = await beginAndSeed(value, {
      idempotencyKey: "image-begin-0001",
      bytes,
      expectedDigest: sha256(bytes),
      expectedSizeBytes: bytes.length,
    });
    expect(upload.requiredHeaders).toEqual({
      contentType: "image/png",
      contentLength: bytes.length,
    });
    expect(value.store.uploadHandoffRequests[0]).toMatchObject({
      contentLength: bytes.length,
      expiresInSeconds: 300,
    });
    const artifact = await value.service.completeImageUpload({
      workspaceId: "workspace-1",
      principalId: "principal-1",
      idempotencyKey: "image-complete-1",
      uploadId: upload.uploadId,
    });

    expect(artifact).toMatchObject({
      kind: "image",
      digest: sha256(bytes),
      sizeBytes: bytes.length,
      mediaType: "image/png",
      width: 1,
      height: 1,
      creatorPrincipalId: "principal-1",
    });
    expect(value.repository.contents.size).toBe(1);
    expect(value.repository.artifacts.size).toBe(1);
    expect(value.store.staged.size).toBe(0);
    expect(JSON.stringify(artifact)).not.toContain("storageKey");
    expect(JSON.stringify(value.repository.auditEvents)).not.toContain(
      "https://",
    );
  });

  it("rejects upload digest, media, and Principal mismatches without canonical Artifact state", async () => {
    const bytes = Buffer.from("fake-image-bytes");
    for (const setup of [
      {
        expectedDigest: `sha256:${"0".repeat(64)}`,
        expectedSizeBytes: bytes.length,
        observed: "image/png",
      },
      {
        expectedDigest: sha256(bytes),
        expectedSizeBytes: bytes.length,
        observed: "image/jpeg",
      },
    ]) {
      const value = fixture();
      const upload = await beginAndSeed(value, {
        idempotencyKey: `mismatch-${setup.observed}`,
        bytes,
        expectedDigest: setup.expectedDigest,
        expectedSizeBytes: setup.expectedSizeBytes,
      });
      value.inspector.result.mediaType = setup.observed;
      await expect(
        value.service.completeImageUpload({
          workspaceId: "workspace-1",
          principalId: "principal-1",
          idempotencyKey: "complete-mismatch",
          uploadId: upload.uploadId,
        }),
      ).rejects.toMatchObject({ code: "ARTIFACT_CONTENT_MISMATCH" });
      expect(value.repository.artifacts.size).toBe(0);
      expect(value.repository.contents.size).toBe(0);
      expect(value.store.staged.size).toBe(0);
      expect(
        value.repository.uploads.get(upload.uploadId),
      ).toMatchObject({ status: "failed", completedAt: now });
    }

    const principalValue = fixture();
    const upload = await beginAndSeed(principalValue, {
      idempotencyKey: "principal-bound",
      bytes,
    });
    await expect(
      principalValue.service.completeImageUpload({
        workspaceId: "workspace-1",
        principalId: "principal-2",
        idempotencyKey: "principal-complete",
        uploadId: upload.uploadId,
      }),
    ).rejects.toMatchObject({ code: "ARTIFACT_UPLOAD_UNAVAILABLE" });
    expect(principalValue.store.content.size).toBe(0);
  });

  it("rejects a staged-object swap between verification and promotion", async () => {
    const value = fixture();
    const bytes = Buffer.from("immutable-source");
    const upload = await beginAndSeed(value, {
      idempotencyKey: "source-swap-begin",
      bytes,
    });
    const record = value.repository.uploads.get(upload.uploadId)!;
    value.store.beforeNextPromote = () => {
      value.store.seedStaged(
        record.stagingKey,
        Buffer.alloc(bytes.length, 120),
        "image/png",
      );
    };

    await expect(
      value.service.completeImageUpload({
        workspaceId: "workspace-1",
        principalId: "principal-1",
        idempotencyKey: "source-swap-complete",
        uploadId: upload.uploadId,
      }),
    ).rejects.toMatchObject({
      code: "ARTIFACT_CONTENT_STORE_UNAVAILABLE",
    });
    expect(value.repository.artifacts.size).toBe(0);
    expect(value.repository.contents.size).toBe(0);
    expect(value.store.content.size).toBe(0);
  });

  it("bounds replay handoffs to the session and rejects expired normal and concurrent replays", async () => {
    let current = now;
    const value = fixture();
    const service = new ArtifactService(
      value.repository,
      value.store,
      value.inspector,
      value.cursor,
      { now: () => current },
    );
    const request = {
      workspaceId: "workspace-1",
      principalId: "principal-1",
      idempotencyKey: "session-replay-begin",
      mediaType: "image/png",
      expectedSizeBytes: 5,
    } as const;
    const begun = await service.beginImageUpload(request);
    const upload = value.repository.uploads.get(begun.uploadId)!;

    current = new Date(upload.expiresAt.getTime() - 2_500);
    const replay = await service.beginImageUpload(request);
    expect(replay.expiresAt).toBe(
      new Date(current.getTime() + 2_000).toISOString(),
    );
    expect(value.store.uploadHandoffRequests.at(-1)).toMatchObject({
      expiresInSeconds: 2,
    });

    current = upload.expiresAt;
    await expect(service.beginImageUpload(request)).rejects.toMatchObject({
      code: "ARTIFACT_UPLOAD_UNAVAILABLE",
    });
    expect(value.repository.uploads.get(upload.id)).toMatchObject({
      status: "failed",
      completedAt: current,
    });

    let concurrentNow = now;
    const concurrent = fixture();
    const concurrentService = new ArtifactService(
      concurrent.repository,
      concurrent.store,
      concurrent.inspector,
      concurrent.cursor,
      { now: () => concurrentNow },
    );
    const concurrentBegun =
      await concurrentService.beginImageUpload(request);
    const concurrentUpload = concurrent.repository.uploads.get(
      concurrentBegun.uploadId,
    )!;
    concurrentNow = concurrentUpload.expiresAt;
    const originalRead =
      concurrent.repository.readMutationReceipt.bind(concurrent.repository);
    concurrent.repository.readMutationReceipt = async (input) =>
      input.capability === "artifact_uploads.begin@1"
        ? { kind: "absent" as const }
        : originalRead(input);
    await expect(
      concurrentService.beginImageUpload(request),
    ).rejects.toMatchObject({ code: "ARTIFACT_UPLOAD_UNAVAILABLE" });
    expect(concurrent.repository.uploads.get(concurrentUpload.id)).toMatchObject(
      { status: "failed", completedAt: concurrentNow },
    );
  });

  it("requires an exact positive size and janitor cleanup is bounded and retryable", async () => {
    const value = fixture();
    await expect(
      value.service.beginImageUpload({
        workspaceId: "workspace-1",
        principalId: "principal-1",
        idempotencyKey: "missing-size-begin",
        mediaType: "image/png",
        expectedSizeBytes: 0,
      }),
    ).rejects.toMatchObject({ code: "ARTIFACT_INVALID_INPUT" });
    expect(value.store.uploadHandoffs).toHaveLength(0);

    const bytes = Buffer.from("abc");
    const begun = await beginAndSeed(value, {
      idempotencyKey: "janitor-upload",
      bytes,
    });
    const upload = value.repository.uploads.get(begun.uploadId)!;
    value.repository.uploads.set(upload.id, {
      ...upload,
      expiresAt: new Date(now.getTime() - 1),
    });
    value.store.failNextDelete = true;

    await expect(
      value.service.cleanupExpiredUploads({ limit: 1 }),
    ).resolves.toEqual({ attempted: 1, cleaned: 0 });
    expect(value.repository.uploads.get(upload.id)).toMatchObject({
      status: "failed",
      completedAt: null,
    });
    expect(value.store.staged.has(upload.stagingKey)).toBe(true);

    await expect(
      value.service.cleanupExpiredUploads({ limit: 1 }),
    ).resolves.toEqual({ attempted: 1, cleaned: 1 });
    expect(value.repository.uploads.get(upload.id)).toMatchObject({
      status: "failed",
      completedAt: now,
    });
    expect(value.store.staged.has(upload.stagingKey)).toBe(false);
    await expect(value.service.cleanupExpiredUploads()).resolves.toEqual({
      attempted: 0,
      cleaned: 0,
    });
  });

  it("leaves no canonical partial state when content-store or database completion fails", async () => {
    const beginFailure = fixture();
    beginFailure.store.failNextUploadSign = true;
    await expect(
      beginFailure.service.beginImageUpload({
        workspaceId: "workspace-1",
        principalId: "principal-1",
        idempotencyKey: "begin-store-failure",
        mediaType: "image/png",
        expectedSizeBytes: 1,
      }),
    ).rejects.toMatchObject({
      code: "ARTIFACT_CONTENT_STORE_UNAVAILABLE",
    });
    expect(beginFailure.repository.uploads.size).toBe(0);
    expect(beginFailure.repository.receipts.size).toBe(0);

    const bytes = Buffer.from("fake-image-bytes");
    const storeFailure = fixture();
    const storeUpload = await beginAndSeed(storeFailure, {
      idempotencyKey: "store-failure",
      bytes,
    });
    storeFailure.store.failNextPromote = true;
    await expect(
      storeFailure.service.completeImageUpload({
        workspaceId: "workspace-1",
        principalId: "principal-1",
        idempotencyKey: "store-complete",
        uploadId: storeUpload.uploadId,
      }),
    ).rejects.toMatchObject({
      code: "ARTIFACT_CONTENT_STORE_UNAVAILABLE",
    });
    expect(storeFailure.repository.artifacts.size).toBe(0);
    expect(storeFailure.repository.contents.size).toBe(0);

    const databaseFailure = fixture();
    const databaseUpload = await beginAndSeed(databaseFailure, {
      idempotencyKey: "database-failure",
      bytes,
    });
    databaseFailure.repository.failNextCommit = true;
    await expect(
      databaseFailure.service.completeImageUpload({
        workspaceId: "workspace-1",
        principalId: "principal-1",
        idempotencyKey: "database-complete",
        uploadId: databaseUpload.uploadId,
      }),
    ).rejects.toMatchObject({
      code: "ARTIFACT_CONTENT_STORE_UNAVAILABLE",
    });
    expect(databaseFailure.repository.artifacts.size).toBe(0);
    expect(databaseFailure.repository.contents.size).toBe(0);
    expect(databaseFailure.repository.receipts.size).toBe(1);
    expect(databaseFailure.store.content.size).toBe(1);
  });

  it("uses opaque cursors bound to Workspace, Principal, filters, and stable order", async () => {
    const value = fixture();
    const service = new ArtifactService(
      value.repository,
      value.store,
      value.inspector,
      value.cursor,
      {
        // Force the id tie-breaker to carry pagination stability.
        now: () => now,
      },
    );
    const imported = [];
    for (const text of ["a", "b", "c"]) {
      imported.push(
        await service.importText({
          workspaceId: "workspace-1",
          principalId: "principal-1",
          idempotencyKey: `cursor-import-${text}`,
          text,
        }),
      );
    }
    const first = await service.listArtifacts({
      workspaceId: "workspace-1",
      principalId: "principal-1",
      filters: { kind: "text" },
      limit: 2,
    });
    const expectedIds = imported
      .map((artifact) => artifact.id)
      .sort((left, right) => right.localeCompare(left));
    expect(first.artifacts.map((artifact) => artifact.id)).toEqual(
      expectedIds.slice(0, 2),
    );
    expect(first.nextCursor).toBeTruthy();
    expect(first.nextCursor).not.toContain("workspace-1");
    expect(first.nextCursor).not.toContain("principal-1");
    const second = await service.listArtifacts({
      workspaceId: "workspace-1",
      principalId: "principal-1",
      filters: { kind: "text" },
      limit: 2,
      cursor: first.nextCursor!,
    });
    expect(second.artifacts.map((artifact) => artifact.id)).toEqual(
      expectedIds.slice(2),
    );
    for (const invalid of [
      {
        workspaceId: "workspace-2",
        principalId: "principal-1",
        filters: { kind: "text" as const },
      },
      {
        workspaceId: "workspace-1",
        principalId: "principal-2",
        filters: { kind: "text" as const },
      },
      {
        workspaceId: "workspace-1",
        principalId: "principal-1",
        filters: { kind: "image" as const },
      },
    ]) {
      await expect(
        service.listArtifacts({
          ...invalid,
          cursor: first.nextCursor!,
        }),
      ).rejects.toMatchObject({ code: "ARTIFACT_CURSOR_INVALID" });
    }
  });

  it("never signs an unavailable Artifact and withholds a signed handoff when audit fails", async () => {
    const value = fixture();
    await expect(
      value.service.createDownload({
        workspaceId: "workspace-1",
        principalId: "principal-1",
        artifactId: "missing-artifact",
      }),
    ).rejects.toMatchObject({ code: "ARTIFACT_UNAVAILABLE" });
    expect(value.store.downloadHandoffs).toHaveLength(0);

    const bytes = Buffer.from("fake-image-bytes");
    const upload = await beginAndSeed(value, {
      idempotencyKey: "download-begin",
      bytes,
    });
    const artifact = await value.service.completeImageUpload({
      workspaceId: "workspace-1",
      principalId: "principal-1",
      idempotencyKey: "download-complete",
      uploadId: upload.uploadId,
    });
    value.repository.failNextAudit = true;
    await expect(
      value.service.createDownload({
        workspaceId: "workspace-1",
        principalId: "principal-1",
        artifactId: artifact.id,
      }),
    ).rejects.toMatchObject({
      code: "ARTIFACT_CONTENT_STORE_UNAVAILABLE",
    });
    expect(value.store.downloadHandoffs).toHaveLength(1);
    const error = new ArtifactServiceError(
      "ARTIFACT_UNAVAILABLE",
      "Artifact is unavailable.",
    );
    expect(error.message).not.toContain(artifact.id);
  });

  it("reads image bytes only through the runtime seam and revalidates integrity", async () => {
    const value = fixture();
    const bytes = Buffer.from("bounded-reference-image");
    const upload = await beginAndSeed(value, {
      idempotencyKey: "runtime-read-begin",
      bytes,
    });
    const artifact = await value.service.completeImageUpload({
      workspaceId: "workspace-1",
      principalId: "principal-1",
      idempotencyKey: "runtime-read-complete",
      uploadId: upload.uploadId,
    });
    await expect(
      value.service.readArtifactBytes({
        workspaceId: "workspace-1",
        artifactId: artifact.id,
      }),
    ).resolves.toEqual(Uint8Array.from(bytes));
    const content = [...value.store.content.values()][0]!;
    content.bytes[0] = content.bytes[0]! ^ 0xff;
    await expect(
      value.service.readArtifactBytes({
        workspaceId: "workspace-1",
        artifactId: artifact.id,
      }),
    ).rejects.toMatchObject({ code: "ARTIFACT_CONTENT_MISMATCH" });
  });
});
