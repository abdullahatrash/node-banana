import { createHash } from "node:crypto";
import type {
  ArtifactAuditEventRecord,
  ArtifactCommitResult,
  ArtifactContentRecord,
  ArtifactContentStore,
  ArtifactDownloadHandoff,
  ArtifactListFilters,
  ArtifactMediaInspector,
  ArtifactMutationReceiptRecord,
  ArtifactRecord,
  ArtifactRepository,
  ArtifactUploadHandoff,
  ArtifactUploadRecord,
} from "./types";

function receiptKey(receipt: {
  workspaceId: string;
  principalId: string;
  capability: string;
  idempotencyKey: string;
}): string {
  return [
    receipt.workspaceId,
    receipt.principalId,
    receipt.capability,
    receipt.idempotencyKey,
  ].join(":");
}

function contentKey(workspaceId: string, digest: string): string {
  return `${workspaceId}:${digest}`;
}

export class InMemoryArtifactRepository implements ArtifactRepository {
  readonly contents = new Map<string, ArtifactContentRecord>();
  readonly artifacts = new Map<string, ArtifactRecord>();
  readonly uploads = new Map<string, ArtifactUploadRecord>();
  readonly receipts = new Map<string, ArtifactMutationReceiptRecord>();
  readonly auditEvents: ArtifactAuditEventRecord[] = [];
  failNextCommit = false;
  failNextAudit = false;

  async readMutationReceipt(
    input: Parameters<ArtifactRepository["readMutationReceipt"]>[0],
  ) {
    const receipt = this.receipts.get(receiptKey(input));
    if (!receipt) return { kind: "absent" as const };
    return receipt.requestFingerprint === input.requestFingerprint
      ? { kind: "replayed" as const, resourceId: receipt.resourceId }
      : { kind: "conflict" as const };
  }

  private failCommit(): boolean {
    if (!this.failNextCommit) return false;
    this.failNextCommit = false;
    return true;
  }

  private existingReceipt(
    receipt: ArtifactMutationReceiptRecord,
  ): ArtifactCommitResult | null {
    const found = this.receipts.get(receiptKey(receipt));
    if (!found) return null;
    return found.requestFingerprint === receipt.requestFingerprint
      ? { kind: "replayed", resourceId: found.resourceId }
      : { kind: "conflict" };
  }

  async commitTextImport(
    input: Parameters<ArtifactRepository["commitTextImport"]>[0],
  ): Promise<ArtifactCommitResult> {
    const replay = this.existingReceipt(input.receipt);
    if (replay) return replay;
    if (this.failCommit()) return { kind: "unavailable" };
    this.contents.set(
      contentKey(input.content.workspaceId, input.content.digest),
      structuredClone(
        this.contents.get(
          contentKey(input.content.workspaceId, input.content.digest),
        ) ?? input.content,
      ),
    );
    this.artifacts.set(input.artifact.id, structuredClone(input.artifact));
    this.receipts.set(receiptKey(input.receipt), structuredClone(input.receipt));
    this.auditEvents.push(structuredClone(input.event));
    return { kind: "created" };
  }

  async createUpload(
    input: Parameters<ArtifactRepository["createUpload"]>[0],
  ): Promise<ArtifactCommitResult> {
    const replay = this.existingReceipt(input.receipt);
    if (replay) return replay;
    if (this.failCommit()) return { kind: "unavailable" };
    this.uploads.set(input.upload.id, structuredClone(input.upload));
    this.receipts.set(receiptKey(input.receipt), structuredClone(input.receipt));
    this.auditEvents.push(structuredClone(input.event));
    return { kind: "created" };
  }

  async getUpload(
    input: Parameters<ArtifactRepository["getUpload"]>[0],
  ): Promise<ArtifactUploadRecord | null> {
    const upload = this.uploads.get(input.uploadId);
    return upload &&
      upload.workspaceId === input.workspaceId &&
      upload.principalId === input.principalId
      ? structuredClone(upload)
      : null;
  }

  async commitUpload(
    input: Parameters<ArtifactRepository["commitUpload"]>[0],
  ): Promise<ArtifactCommitResult> {
    const replay = this.existingReceipt(input.receipt);
    if (replay) return replay;
    const upload = this.uploads.get(input.uploadId);
    if (
      !upload ||
      upload.workspaceId !== input.artifact.workspaceId ||
      upload.principalId !== input.principalId ||
      upload.status !== "pending" ||
      upload.expiresAt <= input.now
    ) {
      return { kind: "unavailable" };
    }
    if (this.failCommit()) return { kind: "unavailable" };
    this.contents.set(
      contentKey(input.content.workspaceId, input.content.digest),
      structuredClone(
        this.contents.get(
          contentKey(input.content.workspaceId, input.content.digest),
        ) ?? input.content,
      ),
    );
    this.artifacts.set(input.artifact.id, structuredClone(input.artifact));
    this.uploads.set(input.uploadId, {
      ...upload,
      status: "completed",
      artifactId: input.artifact.id,
      completedAt: input.now,
    });
    this.receipts.set(receiptKey(input.receipt), structuredClone(input.receipt));
    this.auditEvents.push(structuredClone(input.event));
    return { kind: "created" };
  }

  async getArtifact(
    input: Parameters<ArtifactRepository["getArtifact"]>[0],
  ) {
    const artifact = this.artifacts.get(input.artifactId);
    if (
      !artifact ||
      artifact.workspaceId !== input.workspaceId ||
      artifact.deletedAt
    ) {
      return null;
    }
    const content = this.contents.get(
      contentKey(input.workspaceId, artifact.contentDigest),
    );
    return content
      ? {
          artifact: structuredClone(artifact),
          content: structuredClone(content),
        }
      : null;
  }

  async listArtifacts(
    input: Parameters<ArtifactRepository["listArtifacts"]>[0],
  ) {
    const matches = (
      artifact: ArtifactRecord,
      filters: ArtifactListFilters,
    ) =>
      artifact.workspaceId === input.workspaceId &&
      !artifact.deletedAt &&
      (!filters.kind || artifact.kind === filters.kind) &&
      (!filters.mediaType || artifact.mediaType === filters.mediaType) &&
      (!filters.creatorPrincipalId ||
        artifact.creatorPrincipalId === filters.creatorPrincipalId);
    return [...this.artifacts.values()]
      .filter((artifact) => matches(artifact, input.filters))
      .filter(
        (artifact) =>
          !input.before ||
          artifact.createdAt < input.before.createdAt ||
          (artifact.createdAt.getTime() === input.before.createdAt.getTime() &&
            artifact.id < input.before.id),
      )
      .sort(
        (left, right) =>
          right.createdAt.getTime() - left.createdAt.getTime() ||
          right.id.localeCompare(left.id),
      )
      .slice(0, input.limit)
      .flatMap((artifact) => {
        const content = this.contents.get(
          contentKey(artifact.workspaceId, artifact.contentDigest),
        );
        return content
          ? [
              {
                artifact: structuredClone(artifact),
                content: structuredClone(content),
              },
            ]
          : [];
      });
  }

  async recordDownloadHandoff(
    event: ArtifactAuditEventRecord,
  ): Promise<boolean> {
    if (this.failNextAudit) {
      this.failNextAudit = false;
      return false;
    }
    this.auditEvents.push(structuredClone(event));
    return true;
  }

  async listUploadsForCleanup(input: {
    now: Date;
    limit: number;
  }): Promise<ArtifactUploadRecord[]> {
    return [...this.uploads.values()]
      .filter(
        (upload) =>
          upload.completedAt === null &&
          (upload.status === "failed" ||
            (upload.status === "pending" && upload.expiresAt <= input.now)),
      )
      .sort(
        (left, right) =>
          left.expiresAt.getTime() - right.expiresAt.getTime() ||
          left.id.localeCompare(right.id),
      )
      .slice(0, input.limit)
      .map((upload) => structuredClone(upload));
  }

  async markUploadFailed(input: {
    workspaceId: string;
    uploadId: string;
    now: Date;
  }): Promise<boolean> {
    const upload = this.uploads.get(input.uploadId);
    if (
      !upload ||
      upload.workspaceId !== input.workspaceId ||
      upload.status === "completed"
    ) {
      return false;
    }
    this.uploads.set(input.uploadId, {
      ...upload,
      status: "failed",
      completedAt: null,
    });
    return true;
  }

  async markUploadStagingCleaned(input: {
    workspaceId: string;
    uploadId: string;
    now: Date;
  }): Promise<boolean> {
    const upload = this.uploads.get(input.uploadId);
    if (
      !upload ||
      upload.workspaceId !== input.workspaceId ||
      upload.status !== "failed"
    ) {
      return false;
    }
    this.uploads.set(input.uploadId, {
      ...upload,
      completedAt: input.now,
    });
    return true;
  }
}

export class InMemoryArtifactContentStore implements ArtifactContentStore {
  readonly staged = new Map<
    string,
    {
      bytes: Uint8Array;
      mediaType: string | null;
      versionId: string;
      etag: string;
    }
  >();
  readonly content = new Map<
    string,
    { bytes: Uint8Array; mediaType: string }
  >();
  readonly uploadHandoffs: string[] = [];
  readonly uploadHandoffRequests: Array<{
    stagingKey: string;
    contentLength: number;
    expiresInSeconds: number;
  }> = [];
  readonly downloadHandoffs: string[] = [];
  failNextRead = false;
  failNextPromote = false;
  failNextUploadSign = false;
  failNextDownloadSign = false;
  failNextDelete = false;
  beforeNextPromote: (() => void) | null = null;
  private nextVersion = 1;

  seedStaged(
    stagingKey: string,
    bytes: Uint8Array,
    mediaType: string | null,
  ): void {
    const copied = Uint8Array.from(bytes);
    this.staged.set(stagingKey, {
      bytes: copied,
      mediaType,
      versionId: `memory-version-${this.nextVersion++}`,
      etag: `"${createHash("sha256").update(copied).digest("hex")}"`,
    });
  }

  async createUploadHandoff(input: {
    stagingKey: string;
    mediaType: string;
    contentLength: number;
    expiresInSeconds: number;
    now: Date;
  }): Promise<ArtifactUploadHandoff> {
    if (this.failNextUploadSign) {
      this.failNextUploadSign = false;
      throw new Error("content store unavailable");
    }
    this.uploadHandoffs.push(input.stagingKey);
    this.uploadHandoffRequests.push({
      stagingKey: input.stagingKey,
      contentLength: input.contentLength,
      expiresInSeconds: input.expiresInSeconds,
    });
    return {
      uploadUrl: `https://upload.invalid/${encodeURIComponent(input.stagingKey)}`,
      expiresAt: new Date(input.now.getTime() + input.expiresInSeconds * 1_000),
    };
  }

  async readStaged(input: { stagingKey: string }) {
    if (this.failNextRead) {
      this.failNextRead = false;
      throw new Error("content store unavailable");
    }
    const found = this.staged.get(input.stagingKey);
    if (!found) throw new Error("staged object unavailable");
    return {
      chunks: (async function* () {
        yield Uint8Array.from(found.bytes);
      })(),
      mediaType: found.mediaType,
      sourceIdentity: {
        versionId: found.versionId,
        etag: found.etag,
        contentLength: found.bytes.byteLength,
      },
    };
  }

  async promoteStaged(input: {
    stagingKey: string;
    workspaceId: string;
    digest: string;
    mediaType: string;
    sourceIdentity: {
      versionId: string | null;
      etag: string;
      contentLength: number;
    };
  }) {
    const beforePromote = this.beforeNextPromote;
    this.beforeNextPromote = null;
    beforePromote?.();
    if (this.failNextPromote) {
      this.failNextPromote = false;
      throw new Error("content store unavailable");
    }
    const found = this.staged.get(input.stagingKey);
    if (!found) throw new Error("staged object unavailable");
    if (
      found.versionId !== input.sourceIdentity.versionId ||
      found.etag !== input.sourceIdentity.etag ||
      found.bytes.byteLength !== input.sourceIdentity.contentLength
    ) {
      throw new Error("staged object changed");
    }
    const storageKey = `artifacts/${input.workspaceId}/${input.digest}`;
    if (!this.content.has(storageKey)) {
      this.content.set(storageKey, {
        bytes: Uint8Array.from(found.bytes),
        mediaType: input.mediaType,
      });
    }
    return { storageKey };
  }

  async createDownloadHandoff(input: {
    storageKey: string;
    mediaType: string;
    expiresInSeconds: number;
    now: Date;
  }): Promise<ArtifactDownloadHandoff> {
    if (this.failNextDownloadSign) {
      this.failNextDownloadSign = false;
      throw new Error("content store unavailable");
    }
    if (!this.content.has(input.storageKey)) {
      throw new Error("content unavailable");
    }
    this.downloadHandoffs.push(input.storageKey);
    return {
      downloadUrl: `https://download.invalid/${encodeURIComponent(input.storageKey)}`,
      expiresAt: new Date(input.now.getTime() + input.expiresInSeconds * 1_000),
    };
  }

  async deleteStaged(input: { stagingKey: string }): Promise<void> {
    if (this.failNextDelete) {
      this.failNextDelete = false;
      throw new Error("content store unavailable");
    }
    this.staged.delete(input.stagingKey);
  }
}

export class InMemoryArtifactMediaInspector
  implements ArtifactMediaInspector
{
  result: {
    mediaType: string;
    width: number;
    height: number;
  } = {
    mediaType: "image/png",
    width: 1,
    height: 1,
  };
  failNext = false;

  async inspectImage(): Promise<{
    mediaType: string;
    width: number;
    height: number;
  }> {
    if (this.failNext) {
      this.failNext = false;
      throw new Error("invalid image");
    }
    return { ...this.result };
  }
}
