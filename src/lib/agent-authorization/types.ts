/**
 * Compatibility re-export. Reusable authorization types are owned by the
 * central `src/types` domain hub.
 */
export type {
  AgentAuthorizationDecisionRecord,
  AgentAuthorizationRepository,
  AgentCapabilityGrant,
  AgentGrantRevisionRecord,
  AgentGrantSetRecord,
  AgentResourceConstraints,
  AgentResourceKind,
  AgentResourceRef,
  AgentKeyAuthorizationScope,
  AgentSecurityEventRecord,
  AuthorizationDecisionReason,
  CapabilityAuthorizationAdmission,
  CapabilityAuthorizationRequest,
  CapabilityAuthorizer,
  WorkspaceAgentPolicyRecord,
} from "@/types/agentAuthorization";
