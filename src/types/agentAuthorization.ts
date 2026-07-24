import type {
  AgentKeyRecord,
  AgentPrincipalRecord,
  AgentSecurityContext,
} from "./agentAuth";
import type { CapabilityIdentity } from "./capabilities";
import type { ResolvedSecurityContext } from "./capabilities";

export type AgentResourceKind =
  | "channel"
  | "credential_profile"
  | "workflow"
  | "automation";

export interface AgentResourceRef {
  kind: AgentResourceKind;
  id: string;
}

export interface AgentResourceConstraints {
  channelIds: string[];
  credentialProfileIds: string[];
  workflowIds: string[];
  automationIds: string[];
}

export interface AgentCapabilityGrant {
  capability: string;
  authorizationContractDigest: string;
  resources: AgentResourceConstraints;
}

export interface AgentKeyAuthorizationScope {
  capability: string;
  authorizationContractDigest: string;
  resources: AgentResourceConstraints;
}

export interface AgentGrantSetRecord {
  id: string;
  workspaceId: string;
  principalId: string;
  name: string;
  activeRevision: number | null;
  disabledAt: Date | null;
  createdByUserId: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface AgentGrantRevisionRecord {
  id: string;
  grantSetId: string;
  revision: number;
  grants: AgentCapabilityGrant[];
  createdByUserId: string;
  createdAt: Date;
}

export interface WorkspaceAgentPolicyRecord {
  workspaceId: string;
  activeRevisionId: string;
  revision: number;
  enabled: boolean;
  grants: AgentCapabilityGrant[];
  updatedByUserId: string;
  updatedAt: Date;
}

export type AuthorizationDecisionReason =
  | "allowed"
  | "principal_inactive"
  | "key_inactive"
  | "capability_not_granted"
  | "resource_not_granted"
  | "workspace_policy_denied"
  | "resource_unavailable";

export interface AgentAuthorizationDecisionRecord {
  id: string;
  workspaceId: string;
  principalId: string;
  keyId: string;
  capabilityName: string;
  capabilityVersion: number;
  authorizationContractDigest: string;
  outcome: "allowed" | "denied";
  reason: AuthorizationDecisionReason;
  operatorTraceRef: string;
  grantRevisionId: string | null;
  policyRevisionId: string | null;
  resources: AgentResourceRef[];
  createdAt: Date;
}

export interface AgentSecurityEventRecord {
  id: string;
  workspaceId: string;
  principalId: string | null;
  keyId: string | null;
  actorUserId: string | null;
  eventType:
    | "authorization.allowed"
    | "authorization.denied"
    | "policy.revised"
    | "grant.revised"
    | "key.issued"
    | "key.revoked"
    | "principal.status_changed";
  capabilityName: string;
  capabilityVersion: number;
  reason: AuthorizationDecisionReason;
  resourceKinds: AgentResourceKind[];
  changeRef: string | null;
  revision: number | null;
  principalStatus: import("./agentAuth").AgentPrincipalStatus | null;
  createdAt: Date;
}

export interface AgentAuthorizationRepository {
  admit(input: {
    request: CapabilityAuthorizationRequest;
    resources: AgentResourceRef[];
    decisionId: string;
    securityEventId: string;
    operatorTraceRef: string;
    now: Date;
    forceResourceUnavailable: boolean;
  }): Promise<{
    allowed: boolean;
    reason: AuthorizationDecisionReason;
    grantRevisionId: string | null;
    policyRevisionId: string | null;
    effectiveResources?: AgentResourceConstraints;
  }>;
  createGrantSetWithRevision(input: {
    grantSet: AgentGrantSetRecord;
    revision: AgentGrantRevisionRecord;
  }): Promise<void>;
  appendGrantRevisionAndActivate(input: {
    grantSetId: string;
    workspaceId: string;
    expectedActiveRevision: number;
    revision: AgentGrantRevisionRecord;
    activatedAt: Date;
  }): Promise<boolean>;
  putWorkspacePolicy(
    policy: WorkspaceAgentPolicyRecord,
  ): Promise<WorkspaceAgentPolicyRecord>;
  issueAttenuatedKey(input: {
    workspaceId: string;
    principalId: string;
    actorUserId: string;
    key: AgentKeyRecord;
    now: Date;
  }): Promise<boolean>;
  provisionAuthority(input: {
    workspaceId: string;
    principalId: string;
    actorUserId: string;
    requestId: string;
    requestFingerprint: string;
    grantSetId?: string;
    grantSetName: string;
    expectedGrantRevision?: number;
    expectedPolicyRevision: number;
    grants: AgentCapabilityGrant[];
    policyGrants: AgentCapabilityGrant[];
    key: AgentKeyRecord;
    now: Date;
  }): Promise<
    | {
        type: "created" | "replayed";
        key: AgentKeyRecord;
        grantSetId: string;
        grantRevisionId: string;
        grantRevision: number;
        policyRevisionId: string;
        policyRevision: number;
      }
    | { type: "conflict" | "forbidden" | "invalid_authority" }
  >;
  listDecisionsForActor(input: {
    workspaceId: string;
    actorUserId: string;
    principalId?: string;
    limit: number;
  }): Promise<AgentAuthorizationDecisionRecord[] | null>;
}

export interface CapabilityAuthorizationRequest {
  securityContext: ResolvedSecurityContext;
  audience: "agent" | "human";
  capability: CapabilityIdentity;
  authorizationContractDigest: string;
  resources: AgentResourceRef[];
  resourceExtractionValid?: boolean;
}

export interface CapabilityAuthorizationAdmission {
  allowed: boolean;
  code?: "CAPABILITY_NOT_AUTHORIZED";
  message?: string;
  operatorTraceRef?: string;
  /**
   * Server-derived intersection of key, Workspace policy, and active grant
   * constraints. Capability input can never supply or widen this value.
   */
  effectiveResources?: AgentResourceConstraints;
}

export interface CapabilityAuthorizer {
  authorize(
    request: CapabilityAuthorizationRequest,
  ): Promise<CapabilityAuthorizationAdmission>;
}
