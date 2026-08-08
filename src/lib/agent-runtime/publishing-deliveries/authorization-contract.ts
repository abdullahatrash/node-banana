import type { CapabilityRegistration } from "@/types/capabilities";
import {
  PUBLISHING_APPROVAL_RELEASE_AUTHORIZATION,
  publishingApprovalReleaseAuthorizationContractDigest,
} from "../publishing-approvals/authorization-contract";

export const PUBLISHING_DELIVERY_CAPABILITY_IDENTITIES = {
  release: { name: "publishing_plan_revisions.release", version: 1 },
  get: { name: "publishing_deliveries.get", version: 1 },
  list: { name: "publishing_deliveries.list", version: 1 },
  events: { name: "publishing_delivery_events.list", version: 1 },
} as const;

/** Caller manifests authorize, but never select or retarget, approved targets. */
export const PUBLISHING_DELIVERY_RELEASE_AUTHORIZATION =
  PUBLISHING_APPROVAL_RELEASE_AUTHORIZATION;

export const PUBLISHING_DELIVERY_GET_AUTHORIZATION: CapabilityRegistration["authorization"] = {
  resources: [
    { kind: "channel", inputPath: "channelIds" },
    { kind: "artifact", inputPath: "artifactIds" },
  ],
};

export const PUBLISHING_DELIVERY_LIST_AUTHORIZATION =
  PUBLISHING_DELIVERY_GET_AUTHORIZATION;

export const PUBLISHING_DELIVERY_EVENTS_AUTHORIZATION =
  PUBLISHING_DELIVERY_GET_AUTHORIZATION;

export function publishingDeliveryReleaseAuthorizationContractDigest(): string {
  return publishingApprovalReleaseAuthorizationContractDigest();
}
