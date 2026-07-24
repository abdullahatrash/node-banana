import { createHash, randomUUID } from "node:crypto";
import { canonicalDigest } from "@/lib/agent-tools/canonical";
import {
  ArtifactServiceError,
  type ArtifactServiceErrorCode,
} from "./errors";
import type {
  ArtifactAuditEventRecord,
  ArtifactContentRecord,
  ArtifactContentStore,
  ArtifactCursorCodec,
  ArtifactListFilters,
  ArtifactMediaInspector,
  ArtifactMetadata,
  ArtifactMutationCapability,
  ArtifactMutationReceiptRecord,
  ArtifactRecord,
  ArtifactRepository,
} from "./types";
import {
  ARTIFACT_IDEMPOTENCY_KEY_MAX_LENGTH,
  ARTIFACT_IDEMPOTENCY_KEY_MIN_LENGTH,
  ARTIFACT_MAX_IMAGE_BYTES,
  ARTIFACT_MAX_TEXT_BYTES,
  ARTIFACT_TEXT_MEDIA_TYPE,
  isValidArtifactDigest,
  isValidArtifactId,
  isValidArtifactIdempotencyKey,
  isValidArtifactMediaType,
  normalizeArtifactMediaType,
} from "./validation";

const UPLOAD_HANDOFF_TTL_SECONDS = 300;
const UPLOAD_SESSION_TTL_MS = 15 * 60 * 1_000;
const DOWNLOAD_HANDOFF_TTL_SECONDS = 120;

export { ArtifactServiceError };
export type { ArtifactServiceErrorCode };

interface ArtifactClock {
  now(): Date;
}

const systemClock: ArtifactClock = { now: () => new Date() };

function digestBytes(bytes: Uint8Array): string {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function assertId(value: string, label: string): string {
  const normalized = value.trim();
  if (!isValidArtifactId(normalized)) {
    throw new ArtifactServiceError(
      "ARTIFACT_INVALID_INPUT",
      `${label} is invalid.`,
    );
  }
  return normalized;
}

function assertIdempotencyKey(value: string): string {
  const normalized = value.trim();
  if (!isValidArtifactIdempotencyKey(normalized)) {
    throw new ArtifactServiceError(
      "ARTIFACT_INVALID_INPUT",
      `A stable idempotency key between ${ARTIFACT_IDEMPOTENCY_KEY_MIN_LENGTH} and ${ARTIFACT_IDEMPOTENCY_KEY_MAX_LENGTH} characters is required.`,
    );
  }
  return normalized;
}

function assertExpectedDigest(value: string | undefined): string | null {
  if (value === undefined) return null;
  const normalized = value.trim().toLowerCase();
  if (!isValidArtifactDigest(normalized)) {
    throw new ArtifactServiceError(
      "ARTIFACT_INVALID_INPUT",
      "Expected digest must be a lowercase SHA-256 digest.",
    );
  }
  return normalized;
}

function assertExpectedSize(value: number | undefined): number | null {
  if (value === undefined) return null;
  if (
    !Number.isSafeInteger(value) ||
    value < 0 ||
    value > ARTIFACT_MAX_IMAGE_BYTES
  ) {
    throw new ArtifactServiceError(
      "ARTIFACT_INVALID_INPUT",
      "Expected content size is invalid.",
    );
  }
  return value;
}

function receipt(input: {
  workspaceId: string;
  principalId: string;
  capability: ArtifactMutationCapability;
  idempotencyKey: string;
  requestFingerprint: string;
  resourceId: string;
  now: Date;
}): ArtifactMutationReceiptRecord {
  return {
    workspaceId: input.workspaceId,
    principalId: input.principalId,
    capability: input.capability,
    idempotencyKey: input.idempotencyKey,
    requestFingerprint: input.requestFingerprint,
    resourceId: input.resourceId,
    createdAt: input.now,
  };
}

function event(input: {
  workspaceId: string;
  principalId: string;
  artifactId?: string;
  uploadId?: string;
  eventType: ArtifactAuditEventRecord["eventType"];
  requestFingerprint?: string;
  now: Date;
}): ArtifactAuditEventRecord {
  return {
    id: randomUUID(),
    workspaceId: input.workspaceId,
    principalId: input.principalId,
    artifactId: input.artifactId ?? null,
    uploadId: input.uploadId ?? null,
    eventType: input.eventType,
    requestFingerprint: input.requestFingerprint ?? null,
    createdAt: input.now,
  };
}

function artifactRecord(input: {
  id: string;
  workspaceId: string;
  principalId: string;
  kind: ArtifactRecord["kind"];
  digest: string;
  mediaType: string;
  sizeBytes: number;
  now: Date;
}): ArtifactRecord {
  return {
    id: input.id,
    workspaceId: input.workspaceId,
    contentDigest: input.digest,
    kind: input.kind,
    mediaType: input.mediaType,
    sizeBytes: input.sizeBytes,
    creatorPrincipalId: input.principalId,
    origin: "imported",
    importedAt: input.now,
    retentionMode: "workspace_default",
    retentionSnapshotAt: input.now,
    createdAt: input.now,
    deletedAt: null,
  };
}

export function artifactMetadata(
  artifact: ArtifactRecord,
  content: ArtifactContentRecord,
): ArtifactMetadata {
  return {
    id: artifact.id,
    workspaceId: artifact.workspaceId,
    kind: artifact.kind,
    digest: artifact.contentDigest,
    sizeBytes: artifact.sizeBytes,
    mediaType: artifact.mediaType,
    width: content.width,
    height: content.height,
    creatorPrincipalId: artifact.creatorPrincipalId,
    origin: {
      kind: "imported",
      importedAt: artifact.importedAt.toISOString(),
    },
    retention: {
      mode: artifact.retentionMode,
      snapshotAt: artifact.retentionSnapshotAt.toISOString(),
    },
    // Imported Artifacts have no invented upstream Artifact lineage.
    lineage: { sourceArtifactIds: [] },
    createdAt: artifact.createdAt.toISOString(),
  };
}

export class ArtifactService {
  constructor(
    private readonly repository: ArtifactRepository,
    private readonly store: ArtifactContentStore,
    private readonly mediaInspector: ArtifactMediaInspector,
    private readonly cursorCodec: ArtifactCursorCodec,
    private readonly clock: ArtifactClock = systemClock,
  ) {}

  async importText(input: {
    workspaceId: string;
    principalId: string;
    idempotencyKey: string;
    text: string;
    mediaType?: string;
    expectedDigest?: string;
    expectedSizeBytes?: number;
  }): Promise<ArtifactMetadata> {
    const workspaceId = assertId(input.workspaceId, "Workspace ID");
    const principalId = assertId(input.principalId, "Principal ID");
    const idempotencyKey = assertIdempotencyKey(input.idempotencyKey);
    const mediaType = normalizeArtifactMediaType(
      input.mediaType ?? ARTIFACT_TEXT_MEDIA_TYPE,
    );
    if (mediaType !== ARTIFACT_TEXT_MEDIA_TYPE) {
      throw new ArtifactServiceError(
        "ARTIFACT_CONTENT_MISMATCH",
        "Text imports must use UTF-8 text/plain media.",
      );
    }
    const bytes = Buffer.from(input.text, "utf8");
    if (bytes.length > ARTIFACT_MAX_TEXT_BYTES) {
      throw new ArtifactServiceError(
        "ARTIFACT_INVALID_INPUT",
        "Inline text exceeds the 1 MiB Artifact limit.",
      );
    }
    const digest = digestBytes(bytes);
    const expectedDigest = assertExpectedDigest(input.expectedDigest);
    const expectedSize = assertExpectedSize(input.expectedSizeBytes);
    if (
      (expectedDigest !== null && expectedDigest !== digest) ||
      (expectedSize !== null && expectedSize !== bytes.length)
    ) {
      throw new ArtifactServiceError(
        "ARTIFACT_CONTENT_MISMATCH",
        "Imported text does not match its declared digest or size.",
      );
    }
    const requestFingerprint = canonicalDigest({
      text: input.text,
      mediaType,
      expectedDigest,
      expectedSizeBytes: expectedSize,
    });
    const replay = await this.repository.readMutationReceipt({
      workspaceId,
      principalId,
      capability: "artifacts.import@1",
      idempotencyKey,
      requestFingerprint,
    });
    if (replay.kind === "conflict") {
      throw new ArtifactServiceError(
        "ARTIFACT_IDEMPOTENCY_CONFLICT",
        "The idempotency key was already used for a different Artifact import.",
      );
    }
    if (replay.kind === "replayed") {
      return this.requireMetadata(workspaceId, replay.resourceId);
    }
    const now = this.clock.now();
    const artifactId = randomUUID();
    const artifact = artifactRecord({
      id: artifactId,
      workspaceId,
      principalId,
      kind: "text",
      digest,
      mediaType,
      sizeBytes: bytes.length,
      now,
    });
    const content: ArtifactContentRecord = {
      workspaceId,
      digest,
      kind: "text",
      mediaType,
      sizeBytes: bytes.length,
      inlineText: input.text,
      storageKey: null,
      width: null,
      height: null,
      createdAt: now,
    };
    const committed = await this.repository.commitTextImport({
      artifact,
      content,
      receipt: receipt({
        workspaceId,
        principalId,
        capability: "artifacts.import@1",
        idempotencyKey,
        requestFingerprint,
        resourceId: artifactId,
        now,
      }),
      event: event({
        workspaceId,
        principalId,
        artifactId,
        eventType: "artifact.imported",
        requestFingerprint,
        now,
      }),
    });
    if (committed.kind === "conflict") {
      throw new ArtifactServiceError(
        "ARTIFACT_IDEMPOTENCY_CONFLICT",
        "The idempotency key was already used for a different Artifact import.",
      );
    }
    if (committed.kind === "replayed") {
      return this.requireMetadata(workspaceId, committed.resourceId);
    }
    if (committed.kind !== "created") {
      throw new ArtifactServiceError(
        "ARTIFACT_CONTENT_STORE_UNAVAILABLE",
        "Artifact metadata could not be committed.",
      );
    }
    return artifactMetadata(artifact, content);
  }

  async beginImageUpload(input: {
    workspaceId: string;
    principalId: string;
    idempotencyKey: string;
    mediaType: string;
    expectedDigest?: string;
    expectedSizeBytes: number;
  }): Promise<{
    uploadId: string;
    uploadUrl: string;
    expiresAt: string;
    requiredHeaders: { contentType: string; contentLength: number };
  }> {
    const workspaceId = assertId(input.workspaceId, "Workspace ID");
    const principalId = assertId(input.principalId, "Principal ID");
    const idempotencyKey = assertIdempotencyKey(input.idempotencyKey);
    const mediaType = normalizeArtifactMediaType(input.mediaType);
    if (
      !isValidArtifactMediaType(mediaType) ||
      !mediaType.startsWith("image/")
    ) {
      throw new ArtifactServiceError(
        "ARTIFACT_INVALID_INPUT",
        "Artifact uploads accept image media only.",
      );
    }
    const expectedDigest = assertExpectedDigest(input.expectedDigest);
    const expectedSizeBytes = assertExpectedSize(input.expectedSizeBytes);
    if (expectedSizeBytes === null || expectedSizeBytes === 0) {
      throw new ArtifactServiceError(
        "ARTIFACT_INVALID_INPUT",
        "An exact positive expected image size is required.",
      );
    }
    const requestFingerprint = canonicalDigest({
      mediaType,
      expectedDigest,
      expectedSizeBytes,
    });
    const previous = await this.repository.readMutationReceipt({
      workspaceId,
      principalId,
      capability: "artifact_uploads.begin@1",
      idempotencyKey,
      requestFingerprint,
    });
    if (previous.kind === "conflict") {
      throw new ArtifactServiceError(
        "ARTIFACT_IDEMPOTENCY_CONFLICT",
        "The idempotency key was already used for a different upload.",
      );
    }
    if (previous.kind === "replayed") {
      const upload = await this.repository.getUpload({
        workspaceId,
        principalId,
        uploadId: previous.resourceId,
      });
      if (!upload || upload.status !== "pending") {
        throw new ArtifactServiceError(
          "ARTIFACT_UPLOAD_UNAVAILABLE",
          "Artifact upload is unavailable.",
        );
      }
      return this.signUpload(upload, this.clock.now());
    }
    const now = this.clock.now();
    const uploadId = randomUUID();
    const scope = createHash("sha256")
      .update(`${workspaceId}:${principalId}`)
      .digest("hex")
      .slice(0, 32);
    const upload = {
      id: uploadId,
      workspaceId,
      principalId,
      stagingKey: `agent-artifacts/staging/${scope}/${uploadId}`,
      declaredMediaType: mediaType,
      expectedDigest,
      expectedSizeBytes,
      status: "pending" as const,
      expiresAt: new Date(now.getTime() + UPLOAD_SESSION_TTL_MS),
      artifactId: null,
      createdAt: now,
      completedAt: null,
    };
    const signed = await this.signUpload(upload, now);
    const committed = await this.repository.createUpload({
      upload,
      receipt: receipt({
        workspaceId,
        principalId,
        capability: "artifact_uploads.begin@1",
        idempotencyKey,
        requestFingerprint,
        resourceId: uploadId,
        now,
      }),
      event: event({
        workspaceId,
        principalId,
        uploadId,
        eventType: "artifact.upload_begun",
        requestFingerprint,
        now,
      }),
    });
    if (committed.kind === "conflict") {
      throw new ArtifactServiceError(
        "ARTIFACT_IDEMPOTENCY_CONFLICT",
        "The idempotency key was already used for a different upload.",
      );
    }
    if (committed.kind === "replayed") {
      const existing = await this.repository.getUpload({
        workspaceId,
        principalId,
        uploadId: committed.resourceId,
      });
      if (!existing || existing.status !== "pending") {
        throw new ArtifactServiceError(
          "ARTIFACT_UPLOAD_UNAVAILABLE",
          "Artifact upload is unavailable.",
        );
      }
      return this.signUpload(existing, this.clock.now());
    }
    if (committed.kind !== "created") {
      throw new ArtifactServiceError(
        "ARTIFACT_CONTENT_STORE_UNAVAILABLE",
        "Artifact upload could not be created.",
      );
    }
    return signed;
  }

  async completeImageUpload(input: {
    workspaceId: string;
    principalId: string;
    idempotencyKey: string;
    uploadId: string;
  }): Promise<ArtifactMetadata> {
    const workspaceId = assertId(input.workspaceId, "Workspace ID");
    const principalId = assertId(input.principalId, "Principal ID");
    const uploadId = assertId(input.uploadId, "Upload ID");
    const idempotencyKey = assertIdempotencyKey(input.idempotencyKey);
    const requestFingerprint = canonicalDigest({ uploadId });
    const previous = await this.repository.readMutationReceipt({
      workspaceId,
      principalId,
      capability: "artifact_uploads.complete@1",
      idempotencyKey,
      requestFingerprint,
    });
    if (previous.kind === "conflict") {
      throw new ArtifactServiceError(
        "ARTIFACT_IDEMPOTENCY_CONFLICT",
        "The idempotency key was already used for a different upload completion.",
      );
    }
    if (previous.kind === "replayed") {
      return this.requireMetadata(workspaceId, previous.resourceId);
    }
    const now = this.clock.now();
    const upload = await this.repository.getUpload({
      workspaceId,
      principalId,
      uploadId,
    });
    if (!upload || upload.status !== "pending") {
      throw new ArtifactServiceError(
        "ARTIFACT_UPLOAD_UNAVAILABLE",
        "Artifact upload is unavailable.",
      );
    }
    if (upload.expiresAt <= now) {
      await this.cleanupTerminalUpload(upload, now);
      throw new ArtifactServiceError(
        "ARTIFACT_UPLOAD_UNAVAILABLE",
        "Artifact upload is unavailable.",
      );
    }
    let snapshot: Awaited<ReturnType<ArtifactContentStore["readStaged"]>>;
    try {
      snapshot = await this.store.readStaged({
        stagingKey: upload.stagingKey,
      });
    } catch {
      throw new ArtifactServiceError(
        "ARTIFACT_CONTENT_STORE_UNAVAILABLE",
        "Artifact upload bytes are unavailable.",
      );
    }
    if (
      snapshot.sourceIdentity.contentLength !==
      upload.expectedSizeBytes
    ) {
      await this.cleanupTerminalUpload(upload, now);
      throw new ArtifactServiceError(
        "ARTIFACT_CONTENT_MISMATCH",
        "Uploaded image does not match its declared size.",
      );
    }
    const chunks: Buffer[] = [];
    const hash = createHash("sha256");
    let sizeBytes = 0;
    try {
      for await (const chunk of snapshot.chunks) {
        sizeBytes += chunk.byteLength;
        if (sizeBytes > ARTIFACT_MAX_IMAGE_BYTES) {
          await this.cleanupTerminalUpload(upload, now);
          throw new ArtifactServiceError(
            "ARTIFACT_INVALID_INPUT",
            "Image Artifact exceeds the 50 MiB limit.",
          );
        }
        const buffer = Buffer.from(chunk);
        hash.update(buffer);
        chunks.push(buffer);
      }
    } catch (error) {
      if (error instanceof ArtifactServiceError) throw error;
      throw new ArtifactServiceError(
        "ARTIFACT_CONTENT_STORE_UNAVAILABLE",
        "Artifact upload bytes could not be read.",
      );
    }
    if (sizeBytes === 0) {
      await this.cleanupTerminalUpload(upload, now);
      throw new ArtifactServiceError(
        "ARTIFACT_CONTENT_MISMATCH",
        "Uploaded Artifact is empty.",
      );
    }
    const bytes = Buffer.concat(chunks, sizeBytes);
    const digest = `sha256:${hash.digest("hex")}`;
    let inspected: Awaited<ReturnType<ArtifactMediaInspector["inspectImage"]>>;
    try {
      inspected = await this.mediaInspector.inspectImage(bytes);
    } catch {
      await this.cleanupTerminalUpload(upload, now);
      throw new ArtifactServiceError(
        "ARTIFACT_CONTENT_MISMATCH",
        "Uploaded bytes are not a supported image.",
      );
    }
    const observedMediaType = normalizeArtifactMediaType(inspected.mediaType);
    const storageMediaType = snapshot.mediaType
      ? normalizeArtifactMediaType(snapshot.mediaType)
      : null;
    if (
      observedMediaType !== upload.declaredMediaType ||
      (storageMediaType !== null &&
        storageMediaType !== upload.declaredMediaType) ||
      snapshot.sourceIdentity.contentLength !== sizeBytes ||
      (upload.expectedDigest !== null && upload.expectedDigest !== digest) ||
      upload.expectedSizeBytes !== sizeBytes
    ) {
      await this.cleanupTerminalUpload(upload, now);
      throw new ArtifactServiceError(
        "ARTIFACT_CONTENT_MISMATCH",
        "Uploaded image does not match its declared digest, size, or media type.",
      );
    }
    let promoted: Awaited<ReturnType<ArtifactContentStore["promoteStaged"]>>;
    try {
      promoted = await this.store.promoteStaged({
        stagingKey: upload.stagingKey,
        workspaceId,
        digest,
        mediaType: observedMediaType,
        sourceIdentity: snapshot.sourceIdentity,
      });
    } catch {
      throw new ArtifactServiceError(
        "ARTIFACT_CONTENT_STORE_UNAVAILABLE",
        "Artifact content could not be promoted.",
      );
    }
    const artifactId = randomUUID();
    const artifact = artifactRecord({
      id: artifactId,
      workspaceId,
      principalId,
      kind: "image",
      digest,
      mediaType: observedMediaType,
      sizeBytes,
      now,
    });
    const content: ArtifactContentRecord = {
      workspaceId,
      digest,
      kind: "image",
      mediaType: observedMediaType,
      sizeBytes,
      inlineText: null,
      storageKey: promoted.storageKey,
      width: inspected.width,
      height: inspected.height,
      createdAt: now,
    };
    const committed = await this.repository.commitUpload({
      artifact,
      content,
      uploadId,
      principalId,
      receipt: receipt({
        workspaceId,
        principalId,
        capability: "artifact_uploads.complete@1",
        idempotencyKey,
        requestFingerprint,
        resourceId: artifactId,
        now,
      }),
      event: event({
        workspaceId,
        principalId,
        artifactId,
        uploadId,
        eventType: "artifact.upload_completed",
        requestFingerprint,
        now,
      }),
      now,
    });
    if (committed.kind === "conflict") {
      throw new ArtifactServiceError(
        "ARTIFACT_IDEMPOTENCY_CONFLICT",
        "The idempotency key was already used for a different upload completion.",
      );
    }
    if (committed.kind === "replayed") {
      return this.requireMetadata(workspaceId, committed.resourceId);
    }
    if (committed.kind !== "created") {
      // The content-addressed promotion is safe to leave as an orphan. Removing
      // it here could race another import of the same digest.
      throw new ArtifactServiceError(
        "ARTIFACT_CONTENT_STORE_UNAVAILABLE",
        "Artifact metadata could not be committed.",
      );
    }
    void this.store
      .deleteStaged({ stagingKey: upload.stagingKey })
      .catch(() => undefined);
    return artifactMetadata(artifact, content);
  }

  async getArtifact(input: {
    workspaceId: string;
    artifactId: string;
  }): Promise<{
    artifact: ArtifactMetadata;
    textContent: string | null;
  }> {
    const workspaceId = assertId(input.workspaceId, "Workspace ID");
    const artifactId = assertId(input.artifactId, "Artifact ID");
    const found = await this.repository.getArtifact({
      workspaceId,
      artifactId,
    });
    if (!found) {
      throw new ArtifactServiceError(
        "ARTIFACT_UNAVAILABLE",
        "Artifact is unavailable.",
      );
    }
    return {
      artifact: artifactMetadata(found.artifact, found.content),
      textContent:
        found.artifact.kind === "text" ? found.content.inlineText : null,
    };
  }

  async listArtifacts(input: {
    workspaceId: string;
    principalId: string;
    filters?: ArtifactListFilters;
    limit?: number;
    cursor?: string;
  }): Promise<{
    artifacts: ArtifactMetadata[];
    nextCursor: string | null;
  }> {
    const workspaceId = assertId(input.workspaceId, "Workspace ID");
    const principalId = assertId(input.principalId, "Principal ID");
    const filters = this.normalizeFilters(input.filters ?? {});
    const limit = input.limit ?? 50;
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
      throw new ArtifactServiceError(
        "ARTIFACT_INVALID_INPUT",
        "Artifact list limit must be between 1 and 100.",
      );
    }
    const filterDigest = canonicalDigest(filters);
    let before;
    if (input.cursor) {
      try {
        before = this.cursorCodec.open({
          cursor: input.cursor,
          workspaceId,
          principalId,
          filterDigest,
        });
      } catch {
        throw new ArtifactServiceError(
          "ARTIFACT_CURSOR_INVALID",
          "Artifact cursor is invalid or unavailable.",
        );
      }
    }
    const rows = await this.repository.listArtifacts({
      workspaceId,
      filters,
      before,
      limit: limit + 1,
    });
    const page = rows.slice(0, limit);
    const last = page.at(-1);
    return {
      artifacts: page.map(({ artifact, content }) =>
        artifactMetadata(artifact, content),
      ),
      nextCursor:
        rows.length > limit && last
          ? this.cursorCodec.seal({
              workspaceId,
              principalId,
              filterDigest,
              position: {
                createdAt: last.artifact.createdAt,
                id: last.artifact.id,
              },
            })
          : null,
    };
  }

  async createDownload(input: {
    workspaceId: string;
    principalId: string;
    artifactId: string;
  }): Promise<{
    artifactId: string;
    downloadUrl: string;
    expiresAt: string;
  }> {
    const workspaceId = assertId(input.workspaceId, "Workspace ID");
    const principalId = assertId(input.principalId, "Principal ID");
    const artifactId = assertId(input.artifactId, "Artifact ID");
    const found = await this.repository.getArtifact({
      workspaceId,
      artifactId,
    });
    if (
      !found ||
      found.artifact.kind !== "image" ||
      !found.content.storageKey
    ) {
      throw new ArtifactServiceError(
        "ARTIFACT_UNAVAILABLE",
        "Artifact is unavailable.",
      );
    }
    const now = this.clock.now();
    let signed;
    try {
      signed = await this.store.createDownloadHandoff({
        storageKey: found.content.storageKey,
        mediaType: found.content.mediaType,
        expiresInSeconds: DOWNLOAD_HANDOFF_TTL_SECONDS,
        now,
      });
    } catch {
      throw new ArtifactServiceError(
        "ARTIFACT_CONTENT_STORE_UNAVAILABLE",
        "Artifact content handoff is unavailable.",
      );
    }
    const audited = await this.repository.recordDownloadHandoff(
      event({
        workspaceId,
        principalId,
        artifactId,
        eventType: "artifact.download_handoff_created",
        now,
      }),
    );
    if (!audited) {
      throw new ArtifactServiceError(
        "ARTIFACT_CONTENT_STORE_UNAVAILABLE",
        "Artifact content handoff is unavailable.",
      );
    }
    return {
      artifactId,
      downloadUrl: signed.downloadUrl,
      expiresAt: signed.expiresAt.toISOString(),
    };
  }

  async cleanupExpiredUploads(input: {
    limit?: number;
  } = {}): Promise<{ attempted: number; cleaned: number }> {
    const limit = input.limit ?? 50;
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
      throw new ArtifactServiceError(
        "ARTIFACT_INVALID_INPUT",
        "Artifact cleanup limit must be between 1 and 100.",
      );
    }
    const now = this.clock.now();
    const uploads = await this.repository.listUploadsForCleanup({
      now,
      limit,
    });
    let cleaned = 0;
    for (const upload of uploads) {
      if (
        !(await this.repository.markUploadFailed({
          workspaceId: upload.workspaceId,
          uploadId: upload.id,
          now,
        }))
      ) {
        continue;
      }
      try {
        await this.store.deleteStaged({ stagingKey: upload.stagingKey });
      } catch {
        continue;
      }
      if (
        await this.repository.markUploadStagingCleaned({
          workspaceId: upload.workspaceId,
          uploadId: upload.id,
          now,
        })
      ) {
        cleaned += 1;
      }
    }
    return { attempted: uploads.length, cleaned };
  }

  private async requireMetadata(
    workspaceId: string,
    artifactId: string,
  ): Promise<ArtifactMetadata> {
    const found = await this.repository.getArtifact({
      workspaceId,
      artifactId,
    });
    if (!found) {
      throw new ArtifactServiceError(
        "ARTIFACT_UNAVAILABLE",
        "Artifact is unavailable.",
      );
    }
    return artifactMetadata(found.artifact, found.content);
  }

  private async signUpload(
    upload: {
      stagingKey: string;
      declaredMediaType: string;
      id: string;
      workspaceId: string;
      expectedSizeBytes: number | null;
      expiresAt: Date;
    },
    now: Date,
  ): Promise<{
    uploadId: string;
    uploadUrl: string;
    expiresAt: string;
    requiredHeaders: { contentType: string; contentLength: number };
  }> {
    const remainingSeconds = Math.floor(
      (upload.expiresAt.getTime() - now.getTime()) / 1_000,
    );
    if (
      remainingSeconds < 1 ||
      upload.expectedSizeBytes === null ||
      upload.expectedSizeBytes < 1
    ) {
      if (remainingSeconds < 1) {
        await this.cleanupTerminalUpload(upload, now);
      }
      throw new ArtifactServiceError(
        "ARTIFACT_UPLOAD_UNAVAILABLE",
        "Artifact upload is unavailable.",
      );
    }
    const expiresInSeconds = Math.min(
      UPLOAD_HANDOFF_TTL_SECONDS,
      remainingSeconds,
    );
    try {
      const signed = await this.store.createUploadHandoff({
        stagingKey: upload.stagingKey,
        mediaType: upload.declaredMediaType,
        contentLength: upload.expectedSizeBytes,
        expiresInSeconds,
        now,
      });
      return {
        uploadId: upload.id,
        uploadUrl: signed.uploadUrl,
        expiresAt: signed.expiresAt.toISOString(),
        requiredHeaders: {
          contentType: upload.declaredMediaType,
          contentLength: upload.expectedSizeBytes,
        },
      };
    } catch {
      throw new ArtifactServiceError(
        "ARTIFACT_CONTENT_STORE_UNAVAILABLE",
        "Artifact upload handoff is unavailable.",
      );
    }
  }

  private async cleanupTerminalUpload(
    upload: {
      id: string;
      workspaceId: string;
      stagingKey: string;
    },
    now: Date,
  ): Promise<void> {
    await this.repository
      .markUploadFailed({
        workspaceId: upload.workspaceId,
        uploadId: upload.id,
        now,
      })
      .catch(() => false);
    try {
      await this.store.deleteStaged({ stagingKey: upload.stagingKey });
    } catch {
      return;
    }
    await this.repository
      .markUploadStagingCleaned({
        workspaceId: upload.workspaceId,
        uploadId: upload.id,
        now,
      })
      .catch(() => false);
  }

  private normalizeFilters(filters: ArtifactListFilters): ArtifactListFilters {
    const normalized: ArtifactListFilters = {};
    if (filters.kind !== undefined) {
      if (filters.kind !== "text" && filters.kind !== "image") {
        throw new ArtifactServiceError(
          "ARTIFACT_INVALID_INPUT",
          "Artifact kind filter is invalid.",
        );
      }
      normalized.kind = filters.kind;
    }
    if (filters.mediaType !== undefined) {
      const mediaType = normalizeArtifactMediaType(filters.mediaType);
      if (
        !isValidArtifactMediaType(mediaType)
      ) {
        throw new ArtifactServiceError(
          "ARTIFACT_INVALID_INPUT",
          "Artifact media type filter is invalid.",
        );
      }
      normalized.mediaType = mediaType;
    }
    if (filters.creatorPrincipalId !== undefined) {
      normalized.creatorPrincipalId = assertId(
        filters.creatorPrincipalId,
        "Creator Principal ID",
      );
    }
    return normalized;
  }
}
