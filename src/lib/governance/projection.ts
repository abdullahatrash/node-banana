import type {
  GovernanceAuditEvent,
  GovernanceCapability,
  GovernanceResource,
  GovernanceResourceKind,
} from "./types";

const ALWAYS_HIDDEN_KINDS = new Set<GovernanceResourceKind>([
  "step_up_challenge",
  "step_up_session",
  "review_guest_session",
]);

const RESOURCE_CAPABILITY: Partial<Record<GovernanceResourceKind, GovernanceCapability[]>> = {
  custom_role: ["roles.manage"],
  member_role_assignment: ["members.manage"],
  invitation_binding: ["members.invite"],
  portfolio: ["portfolios.manage"],
  portfolio_assignment: ["portfolios.manage"],
  review_guest_grant: ["reviews.create"],
  approval_policy: ["approval_policies.manage"],
  approval_request: ["reviews.create", "reviews.decide_content"],
  audit_export: ["audit.export"],
  workspace_export: ["exports.manage"],
  workspace_import: ["imports.manage"],
  data_region_policy: ["regions.manage"],
  retention_policy: ["retention.manage"],
  retention_hold: ["retention.manage"],
  deletion_receipt: ["retention.manage"],
  tombstone: ["retention.manage"],
  safety_decision: ["safety.decide", "safety.appeal"],
  safety_appeal: ["safety.decide", "safety.appeal"],
  bulk_operation: ["bulk.preview", "bulk.execute"],
  workspace_closure: ["workspace.close"],
  membership_projection: ["members.manage"],
};

function sensitiveKey(key: string): boolean {
  return /(?:email|recipient|password|authorization)/i.test(key) ||
    /(?:token|secret|credential|apiKey)/i.test(key) ||
    /^(?:codeDigest|codeSalt|verificationCode)$/i.test(key);
}

export function deepRedactGovernanceValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(deepRedactGovernanceValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([key]) => !sensitiveKey(key))
      .map(([key, nested]) => [key, deepRedactGovernanceValue(nested)]),
  );
}

export function canViewGovernanceResource(
  kind: GovernanceResourceKind,
  capabilities: readonly GovernanceCapability[],
): boolean {
  if (ALWAYS_HIDDEN_KINDS.has(kind)) return false;
  const required = RESOURCE_CAPABILITY[kind];
  return !required || required.some((capability) => capabilities.includes(capability));
}

export function projectGovernanceResource<T>(resource: GovernanceResource<T>): GovernanceResource {
  return {
    ...resource,
    body: deepRedactGovernanceValue(resource.body) as Record<string, unknown>,
  };
}

export function projectGovernanceAuditEvent(event: GovernanceAuditEvent): GovernanceAuditEvent {
  return {
    ...event,
    redactedDetails: deepRedactGovernanceValue(event.redactedDetails) as GovernanceAuditEvent["redactedDetails"],
  };
}
