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
  origin: "imported" | "generated";
  importedAt: Date | null;
  retentionMode: ArtifactRetentionMode;
  retentionSnapshotAt: Date;
  createdAt: Date;
  deletedAt: Date | null;
}

export type ArtifactLineageSource =
  | { kind: "workflow_input"; inputName: string }
  | {
      kind: "step_output";
      stepAttemptId: string;
      outputName: string;
    };

export interface ArtifactLineageInputRecord {
  workspaceId: string;
  artifactId: string;
  position: number;
  port: string;
  kind: ArtifactKind;
  source: ArtifactLineageSource;
  contentDigest: string;
  sourceArtifactId: string | null;
}

export interface ArtifactProviderMetadata {
  evidence: {
    providerRequestId: string | null;
    httpStatus: number | null;
    providerCode: string | null;
    operatorTraceRef: string | null;
    effectDisposition:
      | "not_created"
      | "accepted"
      | "terminal_failed"
      | "unknown";
  };
  usage: Array<
    | {
        dimension: string;
        unit: "count" | "byte" | "millisecond" | "megapixel";
        source: "reported" | "measured" | "estimated";
        quantity: string;
      }
    | {
        dimension: string;
        unit: "count" | "byte" | "millisecond" | "megapixel";
        source: "unknown";
        quantity: null;
      }
  >;
  reportedCost?: {
    amount: string;
    currency: string;
    evidenceRef: string;
  } | null;
  retryAfterMs: number | null;
  pollAfterMs: number | null;
}

export interface ArtifactGeneratedOriginRecord {
  workspaceId: string;
  artifactId: string;
  workflowId: string;
  workflowRevisionId: string;
  workflowRevision: number;
  definitionDigest: string;
  runId: string;
  runStartSnapshotDigest: string;
  stepAttemptId: string;
  stepId: string;
  attempt: number;
  provider: string;
  operationIdentity: string;
  providerOperation: string;
  providerOperationRef: string;
  model: string;
  intentDigest: string;
  providerMetadata: ArtifactProviderMetadata | null;
  effectKey: string;
  outputName: string;
  generatedAt: Date;
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
  origin:
    | {
        kind: "imported";
        importedAt: string;
      }
    | {
        kind: "generated";
        generatedAt: string;
        workflowRevision: {
          workflowId: string;
          revisionId: string;
          revision: number;
          definitionDigest: string;
        };
        run: {
          runId: string;
          startSnapshotDigest: string;
        };
        stepAttempt: {
          stepAttemptId: string;
          stepId: string;
          attempt: number;
        };
        providerOperation: {
          provider: string;
          operationIdentity: string;
          operation: string;
          ref: string;
          model: string;
          intentDigest: string;
          metadata: ArtifactProviderMetadata | null;
        };
        effectKey: string;
        outputName: string;
      };
  retention: {
    mode: ArtifactRetentionMode;
    snapshotAt: string;
  };
  lineage: {
    inputs: Array<{
      port: string;
      kind: ArtifactKind;
      source: ArtifactLineageSource;
      contentDigest: string;
      artifactId: string | null;
    }>;
    sourceArtifactIds: string[];
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

export type GeneratedArtifactCommitResult =
  | { kind: "created" | "replayed" }
  | { kind: "conflict" }
  | { kind: "unavailable" };

export interface ArtifactRepositoryResult {
  artifact: ArtifactRecord;
  content: ArtifactContentRecord;
  generatedOrigin: ArtifactGeneratedOriginRecord | null;
  lineageInputs: ArtifactLineageInputRecord[];
}

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

  commitGenerated(input: {
    artifact: ArtifactRecord;
    content: ArtifactContentRecord;
    origin: ArtifactGeneratedOriginRecord;
    lineageInputs: ArtifactLineageInputRecord[];
  }): Promise<GeneratedArtifactCommitResult>;

  getArtifact(input: {
    workspaceId: string;
    artifactId: string;
  }): Promise<ArtifactRepositoryResult | null>;

  listArtifacts(input: {
    workspaceId: string;
    filters: ArtifactListFilters;
    before?: ArtifactListPosition;
    limit: number;
  }): Promise<
    ArtifactRepositoryResult[]
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

  writeGenerated(input: {
    workspaceId: string;
    digest: string;
    mediaType: string;
    bytes: Uint8Array;
  }): Promise<{ storageKey: string }>;

  readContent(input: {
    storageKey: string;
  }): Promise<{
    chunks: AsyncIterable<Uint8Array>;
    mediaType: string | null;
  }>;

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
