import { canonicalDigest } from "./canonical";
import type { CapabilityIdentity, CapabilityRegistration } from "./contracts";

/** Pure authorization-contract digest helper. Keeping this outside the tool
 * registry prevents domain services from importing the registry's executable
 * tool graph (and creating production initialization cycles). */
export function authorizationContractDigestFor(
  identity: CapabilityIdentity,
  authorization: CapabilityRegistration["authorization"],
): string {
  return canonicalDigest({ identity, authorization });
}
