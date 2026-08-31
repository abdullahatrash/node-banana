export {
  AgentAuthorizationService,
  EMPTY_RESOURCE_CONSTRAINTS,
  normalizeCapabilityGrants,
  normalizeCapabilityScopes,
  normalizeResourceConstraints,
} from "./service";
export { InMemoryAgentAuthorizationRepository } from "./memory-repository";
export { DrizzleAgentAuthorizationRepository } from "./repository";
export type {
  AgentAuthorizationDecisionRecord,
  AgentAuthorizationRepository,
  AgentGrantRevisionRecord,
  AgentGrantSetRecord,
  AgentResourceConstraints,
  AgentResourceKind,
  AgentResourceRef,
  AgentSecurityEventRecord,
  AuthorizationDecisionReason,
  CapabilityAuthorizationAdmission,
  CapabilityAuthorizationRequest,
  CapabilityAuthorizer,
  WorkspaceAgentPolicyRecord,
} from "./types";

import { getDb } from "@/lib/db";
import { AgentAuthorizationService } from "./service";
import { DrizzleAgentAuthorizationRepository } from "./repository";

export const AGENT_AUTHORIZATION_SERVICE = new AgentAuthorizationService(
  new DrizzleAgentAuthorizationRepository(getDb),
);
