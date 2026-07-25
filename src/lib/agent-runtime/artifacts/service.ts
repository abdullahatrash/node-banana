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
  ArtifactGeneratedOriginRecord,
  ArtifactLineageInputRecord,
  ArtifactLineageSource,
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

function generatedArtifactId(input: {
  workspaceId: string;
  effectKey: string;
  outputName: string;
}): string {
  const digest = createHash("sha256")
    .update(
      canonicalDigest({
        schema: "generated-artifact-identity/v1",
        workspaceId: input.workspaceId,
        effectKey: input.effectKey,
        outputName: input.outputName,
      }),
      "utf8",
    )
    .digest("hex");
  return `artifact_${digest}`;
}

function assertId(value: string, label: string): string {
  if (typeof value !== "string") {
    throw new ArtifactServiceError(
      "ARTIFACT_INVALID_INPUT",
      `${label} is invalid.`,
    );
  }
  const normalized = value.trim();
  if (!isValidArtifactId(normalized)) {
    throw new ArtifactServiceError(
      "ARTIFACT_INVALID_INPUT",
      `${label} is invalid.`,
    );
  }
  return normalized;
}

function assertBoundedString(
  value: string,
  label: string,
  maxLength = 500,
): string {
  if (typeof value !== "string") {
    throw new ArtifactServiceError(
      "ARTIFACT_INVALID_INPUT",
      `${label} is invalid.`,
    );
  }
  const normalized = value.trim();
  if (
    normalized !== value ||
    normalized.length === 0 ||
    normalized.length > maxLength ||
    /[\u0000-\u001f\u007f]/.test(normalized)
  ) {
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
  generatedOrigin: ArtifactGeneratedOriginRecord | null = null,
  lineageInputs: ArtifactLineageInputRecord[] = [],
): ArtifactMetadata {
  const origin: ArtifactMetadata["origin"] =
    artifact.origin === "imported"
      ? {
          kind: "imported",
          importedAt: requireImportedAt(artifact).toISOString(),
        }
      : generatedOrigin && generatedOrigin.artifactId === artifact.id
        ? {
            kind: "generated",
            generatedAt: generatedOrigin.generatedAt.toISOString(),
            workflowRevision: {
              workflowId: generatedOrigin.workflowId,
              revisionId: generatedOrigin.workflowRevisionId,
              revision: generatedOrigin.workflowRevision,
              definitionDigest: generatedOrigin.definitionDigest,
            },
            run: {
              runId: generatedOrigin.runId,
              startSnapshotDigest:
                generatedOrigin.runStartSnapshotDigest,
            },
            stepAttempt: {
              stepAttemptId: generatedOrigin.stepAttemptId,
              stepId: generatedOrigin.stepId,
              attempt: generatedOrigin.attempt,
            },
            providerOperation: {
              provider: generatedOrigin.provider,
              operationIdentity:
                generatedOrigin.operationIdentity,
              operation: generatedOrigin.providerOperation,
              ref: generatedOrigin.providerOperationRef,
              model: generatedOrigin.model,
              intentDigest: generatedOrigin.intentDigest,
            },
            effectKey: generatedOrigin.effectKey,
            outputName: generatedOrigin.outputName,
          }
        : unavailableGeneratedOrigin();
  const orderedLineage =
    artifact.origin === "generated"
      ? [...lineageInputs].sort(
          (left, right) => left.position - right.position,
        )
      : [];
  const sourceArtifactIds = [
    ...new Set(
      orderedLineage.flatMap((lineage) =>
        lineage.sourceArtifactId ? [lineage.sourceArtifactId] : [],
      ),
    ),
  ];
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
    origin,
    retention: {
      mode: artifact.retentionMode,
      snapshotAt: artifact.retentionSnapshotAt.toISOString(),
    },
    lineage: {
      inputs: orderedLineage.map((lineage) => ({
        port: lineage.port,
        kind: lineage.kind,
        source: structuredClone(lineage.source),
        contentDigest: lineage.contentDigest,
        artifactId: lineage.sourceArtifactId,
      })),
      sourceArtifactIds,
    },
    createdAt: artifact.createdAt.toISOString(),
  };
}

function requireImportedAt(artifact: ArtifactRecord): Date {
  if (artifact.importedAt === null) {
    throw new ArtifactServiceError(
      "ARTIFACT_UNAVAILABLE",
      "Artifact metadata is unavailable.",
    );
  }
  return artifact.importedAt;
}

function unavailableGeneratedOrigin(): never {
  throw new ArtifactServiceError(
    "ARTIFACT_UNAVAILABLE",
    "Artifact metadata is unavailable.",
  );
}

export type GeneratedArtifactContent =
  | {
      kind: "text";
      text: string;
      mediaType: string;
      digest: string;
      sizeBytes: number;
    }
  | {
      kind: "image";
      bytes: Uint8Array;
      mediaType: string;
      digest: string;
      sizeBytes: number;
      width: number;
      height: number;
    };

export interface GeneratedArtifactLineageInput {
  port: string;
  kind: ArtifactRecord["kind"];
  source: ArtifactLineageSource;
  contentDigest: string;
  sourceArtifactId: string | null;
}

export interface CommitGeneratedArtifactInput {
  workspaceId: string;
  creatorPrincipalId: string;
  effectKey: string;
  outputName: string;
  content: GeneratedArtifactContent;
  origin: Omit<
    ArtifactGeneratedOriginRecord,
    | "workspaceId"
    | "artifactId"
    | "effectKey"
    | "outputName"
    | "generatedAt"
  >;
  lineageInputs: GeneratedArtifactLineageInput[];
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

  /**
   * Runtime-only generated Artifact settlement. This is deliberately not
   * registered as an Application Capability: provider execution owns the
   * Effect Key and calls this boundary after a normalized provider outcome.
   */
  async commitGenerated(
    input: CommitGeneratedArtifactInput,
  ): Promise<ArtifactMetadata> {
    if (
      !input ||
      !input.origin ||
      !Array.isArray(input.lineageInputs)
    ) {
      throw new ArtifactServiceError(
        "ARTIFACT_INVALID_INPUT",
        "Generated Artifact input is invalid.",
      );
    }
    const workspaceId = assertId(input.workspaceId, "Workspace ID");
    const creatorPrincipalId = assertId(
      input.creatorPrincipalId,
      "Creator Principal ID",
    );
    const effectKey = assertBoundedString(
      input.effectKey,
      "Effect Key",
      500,
    );
    const outputName = assertBoundedString(
      input.outputName,
      "Output name",
      200,
    );
    const originInput = input.origin;
    const workflowId = assertId(originInput.workflowId, "Workflow ID");
    const workflowRevisionId = assertId(
      originInput.workflowRevisionId,
      "Workflow Revision ID",
    );
    const runId = assertId(originInput.runId, "Run ID");
    const stepAttemptId = assertId(
      originInput.stepAttemptId,
      "Step Attempt ID",
    );
    const stepId = assertId(originInput.stepId, "Step ID");
    if (
      !Number.isSafeInteger(originInput.workflowRevision) ||
      originInput.workflowRevision < 1 ||
      !Number.isSafeInteger(originInput.attempt) ||
      originInput.attempt < 1
    ) {
      throw new ArtifactServiceError(
        "ARTIFACT_INVALID_INPUT",
        "Generated Artifact revision or attempt is invalid.",
      );
    }
    for (const [value, label] of [
      [originInput.definitionDigest, "Workflow definition digest"],
      [originInput.runStartSnapshotDigest, "Run snapshot digest"],
      [originInput.intentDigest, "Provider intent digest"],
    ] as const) {
      if (!isValidArtifactDigest(value)) {
        throw new ArtifactServiceError(
          "ARTIFACT_INVALID_INPUT",
          `${label} is invalid.`,
        );
      }
    }
    const provider = assertBoundedString(
      originInput.provider,
      "Provider",
      200,
    );
    const operationIdentity = assertBoundedString(
      originInput.operationIdentity,
      "Operation identity",
      300,
    );
    const providerOperation = assertBoundedString(
      originInput.providerOperation,
      "Provider operation",
      300,
    );
    const providerOperationRef = assertBoundedString(
      originInput.providerOperationRef,
      "Provider operation reference",
      500,
    );
    const model = assertBoundedString(originInput.model, "Model", 300);
    const prepared = await this.prepareGeneratedContent(input.content);
    const artifactId = generatedArtifactId({
      workspaceId,
      effectKey,
      outputName,
    });
    const lineageInputs = await this.prepareGeneratedLineage({
      workspaceId,
      artifactId,
      inputs: input.lineageInputs,
    });
    const now = this.clock.now();
    let storageKey: string | null = null;
    if (prepared.kind === "image") {
      try {
        storageKey = (
          await this.store.writeGenerated({
            workspaceId,
            digest: prepared.digest,
            mediaType: prepared.mediaType,
            bytes: prepared.bytes,
          })
        ).storageKey;
      } catch {
        throw new ArtifactServiceError(
          "ARTIFACT_CONTENT_STORE_UNAVAILABLE",
          "Generated Artifact content could not be stored.",
        );
      }
    }
    const artifact: ArtifactRecord = {
      id: artifactId,
      workspaceId,
      contentDigest: prepared.digest,
      kind: prepared.kind,
      mediaType: prepared.mediaType,
      sizeBytes: prepared.sizeBytes,
      creatorPrincipalId,
      origin: "generated",
      importedAt: null,
      retentionMode: "workspace_default",
      retentionSnapshotAt: now,
      createdAt: now,
      deletedAt: null,
    };
    const content: ArtifactContentRecord = {
      workspaceId,
      digest: prepared.digest,
      kind: prepared.kind,
      mediaType: prepared.mediaType,
      sizeBytes: prepared.sizeBytes,
      inlineText:
        prepared.kind === "text" ? prepared.text : null,
      storageKey,
      width: prepared.kind === "image" ? prepared.width : null,
      height: prepared.kind === "image" ? prepared.height : null,
      createdAt: now,
    };
    const origin: ArtifactGeneratedOriginRecord = {
      workspaceId,
      artifactId,
      workflowId,
      workflowRevisionId,
      workflowRevision: originInput.workflowRevision,
      definitionDigest: originInput.definitionDigest,
      runId,
      runStartSnapshotDigest: originInput.runStartSnapshotDigest,
      stepAttemptId,
      stepId,
      attempt: originInput.attempt,
      provider,
      operationIdentity,
      providerOperation,
      providerOperationRef,
      model,
      intentDigest: originInput.intentDigest,
      effectKey,
      outputName,
      generatedAt: now,
    };
    const committed = await this.repository.commitGenerated({
      artifact,
      content,
      origin,
      lineageInputs,
    });
    if (committed.kind === "conflict") {
      throw new ArtifactServiceError(
        "ARTIFACT_IDEMPOTENCY_CONFLICT",
        "The Effect Key and output port are bound to another generated Artifact.",
      );
    }
    if (committed.kind === "unavailable") {
      // Content addressing makes this write safe to retain and converge on a
      // later settlement attempt.
      throw new ArtifactServiceError(
        "ARTIFACT_CONTENT_STORE_UNAVAILABLE",
        "Generated Artifact metadata could not be committed.",
      );
    }
    return this.requireMetadata(workspaceId, artifactId);
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
      artifact: artifactMetadata(
        found.artifact,
        found.content,
        found.generatedOrigin,
        found.lineageInputs,
      ),
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
      artifacts: page.map(
        ({ artifact, content, generatedOrigin, lineageInputs }) =>
          artifactMetadata(
            artifact,
            content,
            generatedOrigin,
            lineageInputs,
          ),
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
    return artifactMetadata(
      found.artifact,
      found.content,
      found.generatedOrigin,
      found.lineageInputs,
    );
  }

  private async prepareGeneratedContent(
    content: GeneratedArtifactContent,
  ): Promise<
    | {
        kind: "text";
        text: string;
        mediaType: string;
        digest: string;
        sizeBytes: number;
      }
    | {
        kind: "image";
        bytes: Uint8Array;
        mediaType: string;
        digest: string;
        sizeBytes: number;
        width: number;
        height: number;
      }
  > {
    if (
      !content ||
      (content.kind !== "text" && content.kind !== "image") ||
      typeof content.mediaType !== "string" ||
      (content.kind === "text" &&
        typeof content.text !== "string") ||
      (content.kind === "image" &&
        !ArrayBuffer.isView(content.bytes))
    ) {
      throw new ArtifactServiceError(
        "ARTIFACT_INVALID_INPUT",
        "Generated Artifact content is invalid.",
      );
    }
    const mediaType = normalizeArtifactMediaType(content.mediaType);
    const bytes =
      content.kind === "text"
        ? Buffer.from(content.text, "utf8")
        : Buffer.from(content.bytes);
    const maxBytes =
      content.kind === "text"
        ? ARTIFACT_MAX_TEXT_BYTES
        : ARTIFACT_MAX_IMAGE_BYTES;
    if (
      bytes.byteLength === 0 ||
      bytes.byteLength > maxBytes ||
      !isValidArtifactDigest(content.digest) ||
      !Number.isSafeInteger(content.sizeBytes) ||
      content.sizeBytes !== bytes.byteLength ||
      content.digest !== digestBytes(bytes)
    ) {
      throw new ArtifactServiceError(
        "ARTIFACT_CONTENT_MISMATCH",
        "Generated Artifact bytes do not match their declared digest or size.",
      );
    }
    if (content.kind === "text") {
      if (mediaType !== ARTIFACT_TEXT_MEDIA_TYPE) {
        throw new ArtifactServiceError(
          "ARTIFACT_CONTENT_MISMATCH",
          "Generated text must use UTF-8 text/plain media.",
        );
      }
      return {
        kind: "text",
        text: content.text,
        mediaType,
        digest: content.digest,
        sizeBytes: content.sizeBytes,
      };
    }
    if (
      !isValidArtifactMediaType(mediaType) ||
      !mediaType.startsWith("image/") ||
      !Number.isSafeInteger(content.width) ||
      content.width < 1 ||
      !Number.isSafeInteger(content.height) ||
      content.height < 1
    ) {
      throw new ArtifactServiceError(
        "ARTIFACT_CONTENT_MISMATCH",
        "Generated image metadata is invalid.",
      );
    }
    let inspected: Awaited<
      ReturnType<ArtifactMediaInspector["inspectImage"]>
    >;
    try {
      inspected = await this.mediaInspector.inspectImage(bytes);
    } catch {
      throw new ArtifactServiceError(
        "ARTIFACT_CONTENT_MISMATCH",
        "Generated bytes are not a supported image.",
      );
    }
    if (
      normalizeArtifactMediaType(inspected.mediaType) !== mediaType ||
      inspected.width !== content.width ||
      inspected.height !== content.height
    ) {
      throw new ArtifactServiceError(
        "ARTIFACT_CONTENT_MISMATCH",
        "Generated image bytes do not match their declared media metadata.",
      );
    }
    return {
      kind: "image",
      bytes: Uint8Array.from(bytes),
      mediaType,
      digest: content.digest,
      sizeBytes: content.sizeBytes,
      width: content.width,
      height: content.height,
    };
  }

  private async prepareGeneratedLineage(input: {
    workspaceId: string;
    artifactId: string;
    inputs: GeneratedArtifactLineageInput[];
  }): Promise<ArtifactLineageInputRecord[]> {
    if (input.inputs.length > 100) {
      throw new ArtifactServiceError(
        "ARTIFACT_INVALID_INPUT",
        "Generated Artifact lineage has too many inputs.",
      );
    }
    const lineage: ArtifactLineageInputRecord[] = [];
    for (const [position, sourceInput] of input.inputs.entries()) {
      const port = assertBoundedString(
        sourceInput.port,
        "Lineage input port",
        200,
      );
      if (
        sourceInput.kind !== "text" &&
        sourceInput.kind !== "image"
      ) {
        throw new ArtifactServiceError(
          "ARTIFACT_INVALID_INPUT",
          "Generated Artifact lineage kind is invalid.",
        );
      }
      if (!isValidArtifactDigest(sourceInput.contentDigest)) {
        throw new ArtifactServiceError(
          "ARTIFACT_INVALID_INPUT",
          "Generated Artifact lineage digest is invalid.",
        );
      }
      const source = this.normalizeLineageSource(sourceInput.source);
      const sourceArtifactId =
        sourceInput.sourceArtifactId === null
          ? null
          : assertId(
              sourceInput.sourceArtifactId,
              "Lineage source Artifact ID",
            );
      if (source.kind === "step_output" && sourceArtifactId === null) {
        throw new ArtifactServiceError(
          "ARTIFACT_UNAVAILABLE",
          "Generated Artifact lineage source is unavailable.",
        );
      }
      if (sourceArtifactId !== null) {
        const found = await this.repository.getArtifact({
          workspaceId: input.workspaceId,
          artifactId: sourceArtifactId,
        });
        if (
          !found ||
          found.artifact.kind !== sourceInput.kind ||
          found.artifact.contentDigest !== sourceInput.contentDigest ||
          (source.kind === "step_output" &&
            (!found.generatedOrigin ||
              found.generatedOrigin.stepAttemptId !==
                source.stepAttemptId ||
              found.generatedOrigin.outputName !== source.outputName))
        ) {
          throw new ArtifactServiceError(
            "ARTIFACT_UNAVAILABLE",
            "Generated Artifact lineage source is unavailable.",
          );
        }
      }
      lineage.push({
        workspaceId: input.workspaceId,
        artifactId: input.artifactId,
        position,
        port,
        kind: sourceInput.kind,
        source,
        contentDigest: sourceInput.contentDigest,
        sourceArtifactId,
      });
    }
    return lineage;
  }

  private normalizeLineageSource(
    source: ArtifactLineageSource,
  ): ArtifactLineageSource {
    if (source.kind === "workflow_input") {
      return {
        kind: "workflow_input",
        inputName: assertBoundedString(
          source.inputName,
          "Workflow input name",
          200,
        ),
      };
    }
    if (source.kind === "step_output") {
      return {
        kind: "step_output",
        stepAttemptId: assertId(
          source.stepAttemptId,
          "Source Step Attempt ID",
        ),
        outputName: assertBoundedString(
          source.outputName,
          "Source output name",
          200,
        ),
      };
    }
    throw new ArtifactServiceError(
      "ARTIFACT_INVALID_INPUT",
      "Generated Artifact lineage source is invalid.",
    );
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
