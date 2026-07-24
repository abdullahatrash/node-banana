import type { CapabilityDispatchContext } from "./contracts";

/**
 * Public discovery needs no Principal or Workspace identity. Authentication
 * work in later runtime slices will resolve a server-owned security context
 * before dispatch and attach it out-of-band through this shape.
 *
 * Deliberately accepts no arguments: transport input must never manufacture
 * Principal or Workspace identity.
 */
export function resolveDiscoveryContext(): CapabilityDispatchContext {
  return {};
}
