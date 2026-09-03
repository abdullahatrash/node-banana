import { authorizationContractDigestFor } from "@/lib/agent-tools/authorization-contract-digest";
import type { CapabilityRegistration } from "@/types/capabilities";

export const PUBLISHING_APPROVAL_CAPABILITY_IDENTITIES = {
  request: { name: "publishing_approvals.request", version: 1 },
  get: { name: "publishing_approvals.get", version: 1 },
  getV2: { name: "publishing_approvals.get", version: 2 },
  list: { name: "publishing_approvals.list", version: 1 },
  decide: { name: "publishing_approvals.decide", version: 1 },
  release: { name: "publishing_plan_revisions.release", version: 1 },
} as const;

export const PUBLISHING_APPROVAL_REQUEST_AUTHORIZATION: CapabilityRegistration["authorization"] = {
  resources: [
    { kind: "channel", inputPath: "channelIds" },
    { kind: "artifact", inputPath: "artifactIds" },
  ],
};

export function publishingApprovalRequestAuthorizationContractDigest(): string {
  return authorizationContractDigestFor(
    PUBLISHING_APPROVAL_CAPABILITY_IDENTITIES.request,
    PUBLISHING_APPROVAL_REQUEST_AUTHORIZATION,
  );
}

export const PUBLISHING_APPROVAL_RELEASE_AUTHORIZATION: CapabilityRegistration["authorization"] = {
  resources: [
    { kind: "channel", inputPath: "channelIds" },
    { kind: "artifact", inputPath: "artifactIds" },
  ],
};

/** Exact independent authorization contract used when #167 consumes Approval. */
export function publishingApprovalReleaseAuthorizationContractDigest(): string {
  return authorizationContractDigestFor(
    PUBLISHING_APPROVAL_CAPABILITY_IDENTITIES.release,
    PUBLISHING_APPROVAL_RELEASE_AUTHORIZATION,
  );
}
