export type ArtifactKind = "text" | "image";

export type ArtifactRetentionMode = "workspace_default";

export interface ArtifactContentRecord {
  workspaceId: string;
  digest: string;
  kind: ArtifactKind;
  mediaType: string;
  sizeBytes: number;
  inlineText: string | null;
  storageKey: string | null;
  width: number | null;
  height: number | null;
  createdAt: Date;
}

export interface ArtifactRecord {
  id: string;
  workspaceId: string;
  contentDigest: string;
  kind: ArtifactKind;
  mediaType: string;
  sizeBytes: number;
  creatorPrincipalId: string;
  origin: "imported";
  importedAt: Date;
  retentionMode: ArtifactRetentionMode;
  retentionSnapshotAt: Date;
  createdAt: Date;
  deletedAt: Date | null;
}

export interface ArtifactMetadata {
  id: string;
  workspaceId: string;
  kind: ArtifactKind;
  digest: string;
  sizeBytes: number;
  mediaType: string;
  width: number | null;
  height: number | null;
  creatorPrincipalId: string;
  origin: {
    kind: "imported";
    importedAt: string;
  };
  retention: {
    mode: ArtifactRetentionMode;
    snapshotAt: string;
  };
  lineage: {
    sourceArtifactIds: [];
  };
  createdAt: string;
}

export interface ArtifactUploadRecord {
  id: string;
  workspaceId: string;
  principalId: string;
  stagingKey: string;
  declaredMediaType: string;
  expectedDigest: string | null;
  expectedSizeBytes: number | null;
  status: "pending" | "completed" | "failed";
  expiresAt: Date;
  artifactId: string | null;
  createdAt: Date;
  /**
   * Successful commit time for completed uploads; staging-cleanup completion
   * time for failed uploads. A failed upload with null remains janitor-retryable.
   */
  completedAt: Date | null;
}

export interface ArtifactMutationReceiptRecord {
  workspaceId: string;
  principalId: string;
  capability: ArtifactMutationCapability;
  idempotencyKey: string;
  requestFingerprint: string;
  resourceId: string;
  createdAt: Date;
}

export type ArtifactMutationCapability =
  | "artifacts.import@1"
  | "artifact_uploads.begin@1"
  | "artifact_uploads.complete@1";

export interface ArtifactAuditEventRecord {
  id: string;
  workspaceId: string;
  principalId: string;
  artifactId: string | null;
  uploadId: string | null;
  eventType:
    | "artifact.imported"
    | "artifact.upload_begun"
    | "artifact.upload_completed"
    | "artifact.download_handoff_created";
  requestFingerprint: string | null;
  createdAt: Date;
}

export interface ArtifactListFilters {
  kind?: ArtifactKind;
  mediaType?: string;
  creatorPrincipalId?: string;
}

export interface ArtifactListPosition {
  createdAt: Date;
  id: string;
}

export type ArtifactReceiptResult =
  | { kind: "absent" }
  | { kind: "conflict" }
  | { kind: "replayed"; resourceId: string };

export type ArtifactCommitResult =
  | { kind: "created" }
  | { kind: "replayed"; resourceId: string }
  | { kind: "conflict" }
  | { kind: "unavailable" };

export interface ArtifactRepository {
  readMutationReceipt(input: {
    workspaceId: string;
    principalId: string;
    capability: ArtifactMutationCapability;
    idempotencyKey: string;
    requestFingerprint: string;
  }): Promise<ArtifactReceiptResult>;

  commitTextImport(input: {
    artifact: ArtifactRecord;
    content: ArtifactContentRecord;
    receipt: ArtifactMutationReceiptRecord;
    event: ArtifactAuditEventRecord;
  }): Promise<ArtifactCommitResult>;

  createUpload(input: {
    upload: ArtifactUploadRecord;
    receipt: ArtifactMutationReceiptRecord;
    event: ArtifactAuditEventRecord;
  }): Promise<ArtifactCommitResult>;

  getUpload(input: {
    workspaceId: string;
    principalId: string;
    uploadId: string;
  }): Promise<ArtifactUploadRecord | null>;

  commitUpload(input: {
    artifact: ArtifactRecord;
    content: ArtifactContentRecord;
    uploadId: string;
    principalId: string;
    receipt: ArtifactMutationReceiptRecord;
    event: ArtifactAuditEventRecord;
    now: Date;
  }): Promise<ArtifactCommitResult>;

  getArtifact(input: {
    workspaceId: string;
    artifactId: string;
  }): Promise<{
    artifact: ArtifactRecord;
    content: ArtifactContentRecord;
  } | null>;

  listArtifacts(input: {
    workspaceId: string;
    filters: ArtifactListFilters;
    before?: ArtifactListPosition;
    limit: number;
  }): Promise<
    Array<{
      artifact: ArtifactRecord;
      content: ArtifactContentRecord;
    }>
  >;

  recordDownloadHandoff(event: ArtifactAuditEventRecord): Promise<boolean>;

  listUploadsForCleanup(input: {
    now: Date;
    limit: number;
  }): Promise<ArtifactUploadRecord[]>;

  markUploadFailed(input: {
    workspaceId: string;
    uploadId: string;
    now: Date;
  }): Promise<boolean>;

  markUploadStagingCleaned(input: {
    workspaceId: string;
    uploadId: string;
    now: Date;
  }): Promise<boolean>;
}

export interface ArtifactUploadHandoff {
  uploadUrl: string;
  expiresAt: Date;
}

export interface ArtifactDownloadHandoff {
  downloadUrl: string;
  expiresAt: Date;
}

export interface ArtifactStagedSourceIdentity {
  versionId: string | null;
  etag: string;
  contentLength: number;
}

export interface ArtifactContentStore {
  createUploadHandoff(input: {
    stagingKey: string;
    mediaType: string;
    contentLength: number;
    expiresInSeconds: number;
    now: Date;
  }): Promise<ArtifactUploadHandoff>;

  readStaged(input: {
    stagingKey: string;
  }): Promise<{
    chunks: AsyncIterable<Uint8Array>;
    mediaType: string | null;
    sourceIdentity: ArtifactStagedSourceIdentity;
  }>;

  promoteStaged(input: {
    stagingKey: string;
    workspaceId: string;
    digest: string;
    mediaType: string;
    sourceIdentity: ArtifactStagedSourceIdentity;
  }): Promise<{ storageKey: string }>;

  createDownloadHandoff(input: {
    storageKey: string;
    mediaType: string;
    expiresInSeconds: number;
    now: Date;
  }): Promise<ArtifactDownloadHandoff>;

  deleteStaged(input: { stagingKey: string }): Promise<void>;
}

export interface ArtifactMediaInspector {
  inspectImage(bytes: Uint8Array): Promise<{
    mediaType: string;
    width: number;
    height: number;
  }>;
}

export interface ArtifactCursorCodec {
  seal(input: {
    workspaceId: string;
    principalId: string;
    filterDigest: string;
    position: ArtifactListPosition;
  }): string;
  open(input: {
    cursor: string;
    workspaceId: string;
    principalId: string;
    filterDigest: string;
  }): ArtifactListPosition;
}
