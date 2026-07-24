export type CredentialProfileStatus = "active" | "disabled";
export type CredentialVersionStatus = "active" | "superseded" | "revoked";
export type SpendGrantMode = "bounded" | "audited_unbounded";
export type SpendGrantStatus = "active" | "revoked";

/**
 * Persisted workflow binding to a logical slot. It intentionally contains no
 * profile/version identifiers so rotation does not rewrite workflow history.
 *
 * A binding is exact: one node, one versioned provider operation, and one slot.
 * Broad node/operation arrays are deliberately not part of the persisted
 * contract.
 */
export const CREDENTIAL_SLOT_PROVIDERS = [
  "gemini",
  "openai",
  "anthropic",
  "replicate",
  "fal",
  "kie",
  "wavespeed",
] as const;

export type CredentialSlotProvider = (typeof CREDENTIAL_SLOT_PROVIDERS)[number];

export interface WorkflowCredentialBinding {
  nodeId: string;
  operationIdentity: string;
  slotId: string;
}

export interface ImmutableWorkflowStepRef {
  workflowId: string;
  workflowRevision: string;
  nodeId: string;
  operationIdentity: string;
}

const SLOT_ID = /^[a-zA-Z0-9_-]{1,200}$/;
const OPERATION_IDENTITY =
  /^(gemini|google|openai|anthropic|replicate|fal|kie|wavespeed)(?:\.[a-z][a-z0-9_]*)+@[1-9][0-9]{0,8}$/;

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function normalizeProvider(value: unknown): CredentialSlotProvider | null {
  if (value === "google") return "gemini";
  return CREDENTIAL_SLOT_PROVIDERS.includes(value as CredentialSlotProvider)
    ? (value as CredentialSlotProvider)
    : null;
}

function getNodeProvider(node: unknown): CredentialSlotProvider | null {
  const record = asRecord(node);
  const data = asRecord(record?.data);
  const selectedModel = asRecord(data?.selectedModel);
  const selectedProvider = normalizeProvider(selectedModel?.provider);
  if (selectedProvider) return selectedProvider;

  const directProvider = normalizeProvider(data?.provider);
  if (directProvider) return directProvider;

  // Legacy Nano Banana workflow nodes predate selectedModel.
  if (record?.type === "nanoBanana") return "gemini";
  return null;
}

function operationProvider(
  operationIdentity: string,
): CredentialSlotProvider | null {
  return normalizeProvider(
    operationIdentity.slice(0, operationIdentity.indexOf(".")),
  );
}

function bindingsMatchWorkflowNodes(
  bindings: WorkflowCredentialBinding[],
  nodes: unknown,
): boolean {
  if (!Array.isArray(nodes)) return bindings.length === 0;

  const nodeById = new Map<string, unknown>();
  for (const node of nodes) {
    const record = asRecord(node);
    if (
      !record ||
      typeof record.id !== "string" ||
      !SLOT_ID.test(record.id) ||
      nodeById.has(record.id)
    ) {
      return false;
    }
    nodeById.set(record.id, node);
  }

  return bindings.every((binding) => {
    const node = nodeById.get(binding.nodeId);
    return (
      node !== undefined &&
      getNodeProvider(node) === operationProvider(binding.operationIdentity)
    );
  });
}

export function parseWorkflowCredentialSlots(
  value: unknown,
  nodes?: unknown,
): WorkflowCredentialBinding[] {
  if (!Array.isArray(value) || value.length > 256) return [];
  const seenNodeOperations = new Set<string>();
  const result: WorkflowCredentialBinding[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object" || Array.isArray(item)) return [];
    const record = item as Record<string, unknown>;
    const allowed = new Set(["nodeId", "operationIdentity", "slotId"]);
    if (Object.keys(record).some((key) => !allowed.has(key))) return [];
    const nodeOperation =
      typeof record.nodeId === "string" &&
      typeof record.operationIdentity === "string"
        ? `${record.nodeId}\u0000${record.operationIdentity}`
        : "";
    if (
      typeof record.nodeId !== "string" ||
      !SLOT_ID.test(record.nodeId) ||
      typeof record.operationIdentity !== "string" ||
      record.operationIdentity.length > 120 ||
      !OPERATION_IDENTITY.test(record.operationIdentity) ||
      typeof record.slotId !== "string" ||
      !SLOT_ID.test(record.slotId) ||
      seenNodeOperations.has(nodeOperation)
    ) {
      return [];
    }
    seenNodeOperations.add(nodeOperation);
    result.push({
      nodeId: record.nodeId,
      operationIdentity: record.operationIdentity,
      slotId: record.slotId,
    });
  }
  return nodes === undefined || bindingsMatchWorkflowNodes(result, nodes)
    ? result
    : [];
}

export interface SafeCredentialProfile {
  id: string;
  workspaceId: string;
  name: string;
  provider: string;
  slotId: string | null;
  slotName: string | null;
  status: CredentialProfileStatus;
  activeVersion: number | null;
  secretHint: string | null;
  rotatedAt: Date | null;
  /** Disabled pre-vault profile which can only be restored by reprovisioning. */
  reprovisionable: boolean;
}

export interface CredentialSpendGrant {
  id: string;
  workspaceId: string;
  principalId: string;
  profileId: string;
  mode: SpendGrantMode;
  limitCents: number | null;
  spentCents: number;
  status: SpendGrantStatus;
  createdByUserId: string;
  createdAt: Date;
  revokedAt: Date | null;
}

export interface CredentialAuditEvent {
  id: string;
  workspaceId: string;
  source: "credential" | "agent";
  eventType: string;
  outcome:
    | "pending"
    | "succeeded"
    | "denied"
    | "failed"
    | "unknown"
    | "released";
  reason: string | null;
  actorUserId: string | null;
  principalId: string | null;
  profileId: string | null;
  correlationRef: string | null;
  idempotencyKey: string | null;
  effectRef: string | null;
  effectSequence: number | null;
  createdAt: Date;
}

export interface CredentialAuditPage {
  events: CredentialAuditEvent[];
  nextCursor: string | null;
}

export interface CredentialEffectIntent {
  effectRef: string;
  workspaceId: string;
  principalId: string;
  slotId: string;
  profileId: string;
  versionId: string;
  version: number;
  provider: string;
  spendGrantId: string;
  priceCeilingCents: number;
  providerOperation: string;
  workflowStepRef: ImmutableWorkflowStepRef;
  providerIntentDigest: string;
  snapshottedAt: string;
}

export interface CredentialEffectResult<Result = unknown> {
  effectRef: string;
  profileId: string;
  versionId: string;
  version: number;
  spendGrantId: string;
  replayed: boolean;
  result: Result;
}

export interface CredentialMetadataReader {
  getSafeProfile(input: {
    workspaceId: string;
    profileId: string;
  }): Promise<SafeCredentialProfile | null>;
}

/**
 * Narrow, secret-free lookup used only while validating immutable Workflow
 * Credential Slot bindings. It intentionally exposes no Credential Version.
 */
export interface WorkflowCredentialMetadataReader {
  getSafeWorkflowSlot(input: {
    workspaceId: string;
    slotId: string;
    provider: string;
  }): Promise<{
    slotId: string;
    profileId: string;
    provider: string;
  } | null>;
}
