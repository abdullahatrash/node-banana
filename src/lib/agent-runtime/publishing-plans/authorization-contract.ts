import { authorizationContractDigestFor } from "@/lib/agent-tools/authorization-contract-digest";
import type { CapabilityRegistration } from "@/types/capabilities";

export const PUBLISHING_PLAN_CAPABILITY_IDENTITIES = {
  validate: { name: "publishing_plan_revisions.validate", version: 1 },
  create: { name: "publishing_plan_revisions.create", version: 1 },
  get: { name: "publishing_plan_revisions.get", version: 1 },
  getV2: { name: "publishing_plan_revisions.get", version: 2 },
  list: { name: "publishing_plan_revisions.list", version: 1 },
} as const;

export const PUBLISHING_PLAN_VALIDATE_AUTHORIZATION: CapabilityRegistration["authorization"] = {
  resources: [
    { kind: "channel", inputPath: "draft.channelIds" },
    { kind: "artifact", inputPath: "draft.artifactIds" },
  ],
};

export const PUBLISHING_PLAN_CREATE_AUTHORIZATION: CapabilityRegistration["authorization"] = {
  resources: [
    { kind: "channel", inputPath: "draft.channelIds" },
    { kind: "artifact", inputPath: "draft.artifactIds" },
  ],
};

export function publishingPlanAuthorizationContractDigest(
  capability:
    | "publishing_plan_revisions.validate@1"
    | "publishing_plan_revisions.create@1",
): string {
  return capability === "publishing_plan_revisions.validate@1"
    ? authorizationContractDigestFor(
        PUBLISHING_PLAN_CAPABILITY_IDENTITIES.validate,
        PUBLISHING_PLAN_VALIDATE_AUTHORIZATION,
      )
    : authorizationContractDigestFor(
        PUBLISHING_PLAN_CAPABILITY_IDENTITIES.create,
        PUBLISHING_PLAN_CREATE_AUTHORIZATION,
      );
}
