import { canonicalDigest } from "@/lib/agent-tools/canonical";

export const PUBLISHING_PLAN_VALIDATION_CONTEXT_TTL_MS = 5 * 60 * 1_000;
export const PUBLISHING_PLAN_RUNTIME_POLICY_IDENTITY =
  "publishing-runtime-policy/default@1";
export const PUBLISHING_PLAN_RUNTIME_POLICY_RULES = Object.freeze([
  "emergency-spend-suspension@1",
]);

export function publishingPlanRuntimePolicyContractDigest(): string {
  return canonicalDigest({
    identity: PUBLISHING_PLAN_RUNTIME_POLICY_IDENTITY,
    rules: PUBLISHING_PLAN_RUNTIME_POLICY_RULES,
  });
}

export const PUBLISHING_PLAN_LINKEDIN_CAPABILITIES = Object.freeze({
  identity: "linkedin-publishing-channel@1",
  platform: "linkedin" as const,
  maxContentLength: 3_000,
  supportsImages: true,
  supportsVideo: false,
  supportsCarousel: true,
  maxImages: 9,
  publishingSettingsContract: "linkedin-publishing-settings@1",
});

export function publishingPlanLinkedInCapabilityVersion(): string {
  return canonicalDigest(PUBLISHING_PLAN_LINKEDIN_CAPABILITIES);
}

export function publishingPlanArtifactVersionDigest(input: {
  id: string;
  workspaceId: string;
  digest: string;
  kind: "text" | "image";
  mediaType: string;
  sizeBytes: number;
  width: number | null;
  height: number | null;
  createdAt: Date;
  deletedAt: Date | null;
}): string {
  return canonicalDigest({
    schema: "publishing-plan-artifact-version/v1",
    ...input,
    createdAt: input.createdAt.toISOString(),
    deletedAt: input.deletedAt?.toISOString() ?? null,
  });
}

export function publishingPlanChannelVersionDigest(input: {
  id: string;
  workspaceId: string;
  platform: "linkedin";
  authorKind: "person" | "organization";
  disabled: boolean;
  requiresReauth: boolean;
  tokenExpiresAt: Date | null;
  hasRefreshToken: boolean;
  updatedAt: Date;
  capabilityVersion: string;
}): string {
  return canonicalDigest({
    schema: "publishing-plan-linkedin-channel-version/v1",
    ...input,
    tokenExpiresAt: input.tokenExpiresAt?.toISOString() ?? null,
    updatedAt: input.updatedAt.toISOString(),
  });
}

export function publishingPlanPolicyStateDigest(input: {
  identity: string;
  contractDigest: string;
  workspaceId: string;
  suspended: boolean;
}): string {
  return canonicalDigest({
    schema: "publishing-plan-runtime-policy-state/v1",
    ...input,
  });
}
