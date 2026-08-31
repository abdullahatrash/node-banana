import type { CapabilityErrorContract } from "@/types/capabilities";

export const ARTIFACT_ERROR_CATALOG = {
  ARTIFACT_INVALID_INPUT: {
    category: "validation",
    retryable: false,
    description: "Artifact input violates the published import contract.",
  },
  ARTIFACT_CONTENT_MISMATCH: {
    category: "conflict",
    retryable: false,
    description:
      "Observed bytes do not match declared digest, size, media metadata, or immutable source identity.",
  },
  ARTIFACT_IDEMPOTENCY_CONFLICT: {
    category: "conflict",
    retryable: false,
    description: "The idempotency key is bound to another request.",
  },
  ARTIFACT_UNAVAILABLE: {
    category: "not_found",
    retryable: false,
    description: "Artifact metadata or content is unavailable.",
  },
  ARTIFACT_UPLOAD_UNAVAILABLE: {
    category: "not_found",
    retryable: false,
    description: "Artifact upload is unavailable.",
  },
  ARTIFACT_CURSOR_INVALID: {
    category: "validation",
    retryable: false,
    description: "Artifact cursor is invalid for this collection.",
  },
  ARTIFACT_CONTENT_STORE_UNAVAILABLE: {
    category: "internal",
    retryable: true,
    description: "Artifact content storage is temporarily unavailable.",
  },
  ARTIFACT_QUOTA_EXCEEDED: {
    category: "authorization",
    retryable: false,
    description:
      "The Artifact exceeds an applicable non-monetary storage Quota Policy.",
  },
} as const satisfies Record<string, Omit<CapabilityErrorContract, "code">>;

export type ArtifactServiceErrorCode = keyof typeof ARTIFACT_ERROR_CATALOG;

export class ArtifactServiceError extends Error {
  readonly retryable: boolean;

  constructor(
    readonly code: ArtifactServiceErrorCode,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "ArtifactServiceError";
    this.retryable = ARTIFACT_ERROR_CATALOG[code].retryable;
  }
}

export const ARTIFACT_ERROR_CONTRACTS: CapabilityErrorContract[] =
  Object.entries(ARTIFACT_ERROR_CATALOG).map(([code, contract]) => ({
    code,
    ...contract,
  }));
