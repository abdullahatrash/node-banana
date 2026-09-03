import {
  createHash,
  randomBytes,
  randomInt,
  randomUUID,
  scryptSync,
  timingSafeEqual,
} from "node:crypto";
import { canonicalDigest } from "@/lib/agent-tools/canonical";
import { BUILT_IN_ROLE_CAPABILITIES, legacyRoleBinding, RESERVED_ROLE_CAPABILITIES } from "./roles";
import type {
  ApprovalPolicyRevision,
  BulkOperationItem,
  CustomRoleRevision,
  GovernanceActor,
  GovernanceAuditEvent,
  GovernanceCanonicalEffect,
  GovernanceCapability,
  GovernanceRepository,
  GovernanceResource,
  GovernanceResourceKind,
  GovernanceSnapshot,
  RetentionRule,
  WorkspaceRoleBinding,
  GovernanceMembershipPort,
} from "./types";
import { GOVERNANCE_CAPABILITIES, RETENTION_CLASSES } from "./types";
import { BUILT_IN_WORKSPACE_ROLES } from "./types";
import { advanceApprovalDeadline, ApprovalPolicyError, createContentAcceptanceProgress, decideContentAcceptance } from "./approval-policy";
import { UNCONFIGURED_GOVERNANCE_REGION_VERIFIER, type GovernanceRegionDeploymentEvidence, type GovernanceRegionVerificationPort } from "./region-policy";
import { RepositoryGovernanceStepUpVerifier } from "./step-up";
import {
  canViewGovernanceResource,
  projectGovernanceAuditEvent,
  projectGovernanceResource,
} from "./projection";

const ID = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$/;
const IDEMPOTENCY = /^[\x20-\x7e]{8,200}$/;
const SHA256 = /^sha256:[a-f0-9]{64}$/;
const MAX_GUEST_LIFETIME_MS = 30 * 24 * 60 * 60 * 1_000;
const MAX_STEP_UP_LIFETIME_MS = 15 * 60 * 1_000;

export class GovernanceError extends Error {
  constructor(
    readonly code:
      | "INVALID_INPUT"
      | "FORBIDDEN"
      | "NOT_FOUND"
      | "CONFLICT"
      | "STEP_UP_REQUIRED"
      | "EXPIRED"
      | "UNSAFE_RETRY",
    message: string,
  ) {
    super(message);
    this.name = "GovernanceError";
  }
}

export type GovernanceCommand =
  | { type: "create_custom_role"; name: string; description: string; capabilities: GovernanceCapability[] }
  | { type: "revise_custom_role"; roleId: string; expectedVersion: number; name: string; description: string; capabilities: GovernanceCapability[] }
  | { type: "assign_role"; userId: string; binding: WorkspaceRoleBinding }
  | { type: "create_invitation"; email: string; binding: WorkspaceRoleBinding; expiresAt: string }
  | { type: "revoke_invitation"; invitationId: string }
  | { type: "remove_member"; userId: string }
  | { type: "transfer_ownership"; newOwnerUserId: string; stepUpToken: string }
  | { type: "request_workspace_closure"; reason: string; coolingOffDays: number; stepUpToken: string }
  | { type: "cancel_workspace_closure"; closureId: string }
  | { type: "execute_workspace_closure"; closureId: string; stepUpToken: string }
  | { type: "create_portfolio"; name: string }
  | { type: "assign_portfolio"; portfolioId: string; assigneeUserId: string; targetWorkspaceId: string; permissions: Array<"navigate" | "report" | "templates" | "bulk">; capabilityAllowlist: string[]; resourceAllowlist: Array<{ kind: string; id: string }>; expiresAt: string | null }
  | { type: "revoke_portfolio_assignment"; assignmentId: string }
  | { type: "issue_review_guest"; email: string; purpose: "inspect" | "comment" | "accept_content" | "approve_publishing" | "reject"; resourceKind: "render_proof" | "plan_revision"; resourceId: string; revisionDigest: string; expiresAt: string }
  | { type: "revoke_review_guest"; grantId: string }
  | { type: "publish_approval_policy"; policyId?: string; expectedVersion?: number; policy: Omit<ApprovalPolicyRevision, "schema" | "revision" | "createdByUserId" | "createdAt"> }
  | { type: "request_content_acceptance"; policyId: string; policyRevision: number; resourceKind: string; resourceId: string; revisionDigest: string }
  | { type: "decide_content_acceptance"; requestId: string; decision: "approve" | "reject" }
  | { type: "advance_content_acceptance"; requestId: string }
  | { type: "begin_step_up"; purpose: string; resourceId: string | null }
  | { type: "verify_step_up"; challengeId: string; code: string }
  | { type: "request_audit_export"; from: string | null; to: string | null; stepUpToken: string }
  | { type: "set_region_policy"; region: string; verificationEvidence: GovernanceRegionDeploymentEvidence; expectedVersion?: number; stepUpToken: string }
  | { type: "publish_retention_policy"; rules: RetentionRule[]; expectedVersion?: number; stepUpToken: string }
  | { type: "create_retention_hold"; retentionClasses: string[]; reason: string; expiresAt: string | null; stepUpToken: string }
  | { type: "release_retention_hold"; holdId: string; reason: string; stepUpToken: string }
  | { type: "record_deletion"; resourceKind: string; resourceId: string; retentionClass: string; systems: string[]; stepUpToken: string }
  | { type: "create_safety_decision"; intentRef: string; reasonCode: string; policyVersion: string; safeExplanation: string; evidenceRef: string; remediation: string; appealEligible: boolean }
  | { type: "appeal_safety_decision"; decisionId: string; explanation: string }
  | { type: "resolve_safety_appeal"; appealId: string; outcome: "upheld" | "reevaluate_exact_intent"; currentRevalidationRequired: true }
  | { type: "preview_bulk"; operationCapability: string; items: Array<{ targetWorkspaceId: string; targetKind: string; targetId: string; input?: Record<string, unknown> }>; concurrency: number; quoteRef: string | null }
  | { type: "start_bulk"; operationId: string; stepUpToken?: string }
  | { type: "cancel_bulk"; operationId: string }
  | { type: "retry_bulk_item"; operationId: string; itemId: string }
  | { type: "preview_import"; source: string; sourceManifestDigest: string; items: Array<{ kind: string; sourceId: string; destinationId?: string; digest: string; transferable: boolean; omissionReason?: string; payload?: Record<string, unknown> }> }
  | { type: "execute_import"; importId: string }
  | { type: "request_workspace_export"; includeKinds: string[]; stepUpToken: string };

const CAPABILITY_BY_COMMAND: Record<GovernanceCommand["type"], GovernanceCapability> = {
  create_custom_role: "roles.manage",
  revise_custom_role: "roles.manage",
  assign_role: "members.manage",
  create_invitation: "members.invite",
  revoke_invitation: "members.invite",
  remove_member: "members.manage",
  transfer_ownership: "workspace.transfer_ownership",
  request_workspace_closure: "workspace.close",
  cancel_workspace_closure: "workspace.close",
  execute_workspace_closure: "workspace.close",
  create_portfolio: "portfolios.manage",
  assign_portfolio: "portfolios.manage",
  revoke_portfolio_assignment: "portfolios.manage",
  issue_review_guest: "reviews.create",
  revoke_review_guest: "reviews.create",
  publish_approval_policy: "approval_policies.manage",
  request_content_acceptance: "reviews.create",
  decide_content_acceptance: "reviews.decide_content",
  advance_content_acceptance: "approval_policies.manage",
  begin_step_up: "governance.view",
  verify_step_up: "governance.view",
  request_audit_export: "audit.export",
  set_region_policy: "regions.manage",
  publish_retention_policy: "retention.manage",
  create_retention_hold: "retention.manage",
  release_retention_hold: "retention.manage",
  record_deletion: "retention.manage",
  create_safety_decision: "safety.decide",
  appeal_safety_decision: "safety.appeal",
  resolve_safety_appeal: "safety.decide",
  preview_bulk: "bulk.preview",
  start_bulk: "bulk.execute",
  cancel_bulk: "bulk.execute",
  retry_bulk_item: "bulk.execute",
  preview_import: "imports.manage",
  execute_import: "imports.manage",
  request_workspace_export: "exports.manage",
};

function safeId(value: string, label: string): string {
  const normalized = value.trim();
  if (!ID.test(normalized)) throw new GovernanceError("INVALID_INPUT", `${label} is invalid.`);
  return normalized;
}

function exactDate(value: string, label: string): Date {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime()) || date.toISOString() !== value) {
    throw new GovernanceError("INVALID_INPUT", `${label} must be a canonical UTC timestamp.`);
  }
  return date;
}

function text(value: string, label: string, max = 500): string {
  const normalized = value.trim();
  if (!normalized || normalized.length > max || /[\u0000-\u001f\u007f]/.test(normalized)) {
    throw new GovernanceError("INVALID_INPUT", `${label} is invalid.`);
  }
  return normalized;
}

function secretDigest(value: string): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function codeDigest(code: string, salt: string): string {
  return `scrypt:${scryptSync(code, salt, 32).toString("hex")}`;
}

function codeMatches(code: string, salt: string, digest: string): boolean {
  if (!digest.startsWith("scrypt:")) return false;
  const candidate = scryptSync(code, salt, 32);
  const expected = Buffer.from(digest.slice(7), "hex");
  return expected.length === candidate.length && timingSafeEqual(candidate, expected);
}

function newId(prefix: string): string {
  return `${prefix}_${randomUUID().replaceAll("-", "")}`;
}

const RECEIPT_SECRET_KEYS = new Set([
  "invitationToken",
  "reviewToken",
  "verificationCode",
  "sessionToken",
  "stepUpToken",
]);

function receiptSafeResult(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(receiptSafeResult);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([key]) => !RECEIPT_SECRET_KEYS.has(key))
      .map(([key, nested]) => [key, receiptSafeResult(nested)]),
  );
}

export function encodeReviewToken(workspaceId: string, grantId: string, secret: string): string {
  return `${Buffer.from(workspaceId, "utf8").toString("base64url")}.${grantId}.${secret}`;
}

export function decodeReviewToken(value: string): { workspaceId: string; grantId: string; secret: string } | null {
  const parts = value.split(".");
  if (parts.length !== 3) return null;
  try {
    const workspaceId = Buffer.from(parts[0], "base64url").toString("utf8");
    return ID.test(workspaceId) && ID.test(parts[1]) && /^[A-Za-z0-9_-]{32,100}$/.test(parts[2])
      ? { workspaceId, grantId: parts[1], secret: parts[2] }
      : null;
  } catch { return null; }
}

export const encodeInvitationToken = encodeReviewToken;
export function decodeInvitationToken(value: string): { workspaceId: string; invitationId: string; secret: string } | null {
  const decoded = decodeReviewToken(value);
  return decoded ? { workspaceId: decoded.workspaceId, invitationId: decoded.grantId, secret: decoded.secret } : null;
}

function resource<T>(input: {
  id: string;
  workspaceId: string;
  kind: GovernanceResourceKind;
  version: number;
  status: string;
  body: T;
  actor: string | null;
  now: Date;
  createdAt?: Date;
}): GovernanceResource<T> {
  return {
    id: input.id,
    workspaceId: input.workspaceId,
    kind: input.kind,
    version: input.version,
    status: input.status,
    body: input.body,
    createdByUserId: input.actor,
    createdAt: input.createdAt ?? input.now,
    updatedAt: input.now,
  };
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

export class GovernanceService {
  constructor(
    private readonly repository: GovernanceRepository,
    private readonly clock: { now(): Date } = { now: () => new Date() },
    private readonly memberships: GovernanceMembershipPort = {
      provisionAcceptedMembership: async () => {},
      removeMembership: async () => "removed",
      transferOwnership: async () => "transferred",
      closeWorkspace: async () => "closed",
    },
    private readonly regionVerification: GovernanceRegionVerificationPort = UNCONFIGURED_GOVERNANCE_REGION_VERIFIER,
  ) {}

  private async roleBinding(actor: GovernanceActor): Promise<WorkspaceRoleBinding> {
    const assignment = await this.repository.getResource<{ binding: WorkspaceRoleBinding }>({
      workspaceId: actor.workspaceId,
      kind: "member_role_assignment",
      id: actor.userId,
    });
    return assignment?.status === "active" ? assignment.body.binding : {
      kind: "built_in" as const,
      role: legacyRoleBinding(actor.legacyRole),
    };
  }

  private async capabilities(actor: GovernanceActor): Promise<GovernanceCapability[]> {
    const binding = await this.roleBinding(actor);
    if (binding.kind === "built_in") return [...BUILT_IN_ROLE_CAPABILITIES[binding.role]];
    const custom = await this.repository.getResource<{ revisions: CustomRoleRevision[] }>({
      workspaceId: actor.workspaceId,
      kind: "custom_role",
      id: binding.roleId,
    });
    const revision = custom?.body.revisions.find((item) => item.revision === binding.roleRevision);
    return revision ? [...revision.capabilities] : [];
  }

  async snapshot(actor: GovernanceActor): Promise<GovernanceSnapshot> {
    const capabilities = await this.capabilities(actor);
    if (!capabilities.includes("governance.view")) throw new GovernanceError("FORBIDDEN", "Governance access denied.");
    const [resources, audit] = await Promise.all([
      this.repository.listResources({ workspaceId: actor.workspaceId }),
      capabilities.includes("audit.view")
        ? this.repository.listAudit({ workspaceId: actor.workspaceId, limit: 100 })
        : Promise.resolve([]),
    ]);
    const visible = resources
      .filter((item) => canViewGovernanceResource(item.kind, capabilities))
      .map(projectGovernanceResource);
    const grouped: GovernanceSnapshot["resources"] = {};
    for (const item of visible) (grouped[item.kind] ??= []).push(item);
    return {
      workspaceId: actor.workspaceId,
      actorCapabilities: capabilities,
      resources: grouped,
      audit: audit.map(projectGovernanceAuditEvent),
    };
  }

  private async require(actor: GovernanceActor, capability: GovernanceCapability) {
    if (!(await this.capabilities(actor)).includes(capability)) {
      throw new GovernanceError("FORBIDDEN", `Capability ${capability} is not granted.`);
    }
  }

  private async requireStepUp(actor: GovernanceActor, purpose: string, resourceId: string | null, token: string) {
    const evidence = await new RepositoryGovernanceStepUpVerifier(this.repository).verify({ workspaceId: actor.workspaceId, userId: actor.userId, purpose, resourceId, token, evaluatedAt: this.clock.now() });
    if (!evidence) throw new GovernanceError("STEP_UP_REQUIRED", "A current exact-scope step-up is required.");
  }

  private audit(input: {
    actor: GovernanceActor;
    capability: GovernanceCapability;
    command: GovernanceCommand;
    target: { kind: string; id: string } | null;
    now: Date;
  }): GovernanceAuditEvent {
    return {
      schema: "workspace-audit-event/v1",
      id: newId("audit"),
      workspaceId: input.actor.workspaceId,
      actor: { kind: "human", id: input.actor.userId },
      capability: `${input.capability}@1`,
      action: input.command.type,
      resource: input.target,
      outcome: "completed",
      redactedDetails: { requestDigest: canonicalDigest(input.command) },
      occurredAt: input.now,
    };
  }

  private async commit(input: {
    actor: GovernanceActor;
    command: GovernanceCommand;
    capability: GovernanceCapability;
    idempotencyKey: string;
    mutations: Parameters<GovernanceRepository["commit"]>[0]["mutations"];
    result: unknown;
    target: { kind: string; id: string } | null;
    now: Date;
    canonicalEffects?: GovernanceCanonicalEffect[];
  }): Promise<unknown> {
    if (!IDEMPOTENCY.test(input.idempotencyKey)) throw new GovernanceError("INVALID_INPUT", "A stable idempotency key is required.");
    const requestDigest = canonicalDigest(input.command);
    const outcome = await this.repository.commit({
      receipt: {
        workspaceId: input.actor.workspaceId,
        capability: `${input.capability}@1`,
        idempotencyKey: input.idempotencyKey,
        requestDigest,
        result: receiptSafeResult(input.result),
        createdAt: input.now,
      },
      mutations: input.mutations,
      canonicalEffects: input.canonicalEffects,
      audit: this.audit({ actor: input.actor, capability: input.capability, command: input.command, target: input.target, now: input.now }),
    });
    if (outcome.type === "conflict") throw new GovernanceError("CONFLICT", "The resource or idempotency key conflicts with current state.");
    return outcome.type === "committed" ? input.result : outcome.result;
  }

  private async preflight(input: {
    workspaceId: string;
    capability: string;
    idempotencyKey: string;
    requestDigest: string;
  }): Promise<unknown | undefined> {
    if (!IDEMPOTENCY.test(input.idempotencyKey)) {
      throw new GovernanceError("INVALID_INPUT", "A stable idempotency key is required.");
    }
    const existing = await this.repository.findReceipt(input);
    if (!existing) return undefined;
    if (existing.requestDigest !== input.requestDigest) {
      throw new GovernanceError("CONFLICT", "The idempotency key is already bound to another request.");
    }
    return existing.result;
  }

  async execute(actor: GovernanceActor, command: GovernanceCommand, idempotencyKey: string): Promise<unknown> {
    const capability = CAPABILITY_BY_COMMAND[command.type];
    const replay = await this.preflight({
      workspaceId: actor.workspaceId,
      capability: `${capability}@1`,
      idempotencyKey,
      requestDigest: canonicalDigest(command),
    });
    if (replay !== undefined) return replay;
    await this.require(actor, capability);
    const now = this.clock.now();
    const create = <T>(kind: GovernanceResourceKind, id: string, status: string, body: T) => ({
      type: "create" as const,
      expectedVersion: null,
      resource: resource({ id, workspaceId: actor.workspaceId, kind, version: 1, status, body, actor: actor.userId, now }),
    });
    const update = <T>(current: GovernanceResource, status: string, body: T) => ({
      type: "update" as const,
      expectedVersion: current.version,
      resource: resource({ id: current.id, workspaceId: actor.workspaceId, kind: current.kind, version: current.version + 1, status, body, actor: current.createdByUserId, now, createdAt: current.createdAt }),
    });
    let mutations: Parameters<GovernanceRepository["commit"]>[0]["mutations"] = [];
    let result: Record<string, unknown>;
    let target: { kind: string; id: string } | null = null;
    let canonicalEffects: GovernanceCanonicalEffect[] = [];

    switch (command.type) {
      case "create_custom_role": {
        const capabilities = unique(command.capabilities);
        if (!capabilities.length || capabilities.some((item) => !GOVERNANCE_CAPABILITIES.includes(item)) || capabilities.some((item) => RESERVED_ROLE_CAPABILITIES.has(item))) {
          throw new GovernanceError("INVALID_INPUT", "Custom Role capabilities are invalid or reserved.");
        }
        const id = newId("role");
        const revision: CustomRoleRevision = { schema: "custom-role-revision/v1", revision: 1, name: text(command.name, "Role name", 80), description: text(command.description, "Role description", 500), capabilities, createdByUserId: actor.userId, createdAt: now.toISOString() };
        mutations = [create("custom_role", id, "active", { revisions: [revision], activeRevision: 1 })];
        result = { roleId: id, revision };
        target = { kind: "custom_role", id };
        break;
      }
      case "revise_custom_role": {
        const id = safeId(command.roleId, "Role");
        const current = await this.repository.getResource<{ revisions: CustomRoleRevision[]; activeRevision: number }>({ workspaceId: actor.workspaceId, kind: "custom_role", id });
        if (!current) throw new GovernanceError("NOT_FOUND", "Custom Role unavailable.");
        if (current.version !== command.expectedVersion) throw new GovernanceError("CONFLICT", "Custom Role changed.");
        const capabilities = unique(command.capabilities);
        if (!capabilities.length || capabilities.some((item) => !GOVERNANCE_CAPABILITIES.includes(item)) || capabilities.some((item) => RESERVED_ROLE_CAPABILITIES.has(item))) throw new GovernanceError("INVALID_INPUT", "Custom Role capabilities are invalid or reserved.");
        const revision: CustomRoleRevision = { schema: "custom-role-revision/v1", revision: current.body.revisions.length + 1, name: text(command.name, "Role name", 80), description: text(command.description, "Role description", 500), capabilities, createdByUserId: actor.userId, createdAt: now.toISOString() };
        mutations = [update(current, "active", { revisions: [...current.body.revisions, revision], activeRevision: revision.revision })];
        result = { roleId: id, revision };
        target = { kind: "custom_role", id };
        break;
      }
      case "assign_role": {
        const userId = safeId(command.userId, "User");
        await this.validateRoleBinding(actor.workspaceId, command.binding);
        if (command.binding.kind === "built_in" && command.binding.role === "owner") throw new GovernanceError("INVALID_INPUT", "Owner may only change through the ownership-transfer lifecycle.");
        if (command.binding.kind === "custom") {
          const binding = command.binding;
          const role = await this.repository.getResource<{ revisions: CustomRoleRevision[] }>({ workspaceId: actor.workspaceId, kind: "custom_role", id: safeId(binding.roleId, "Role") });
          if (!role?.body.revisions.some((item) => item.revision === binding.roleRevision)) throw new GovernanceError("NOT_FOUND", "The exact Custom Role revision is unavailable.");
        }
        const current = await this.repository.getResource({ workspaceId: actor.workspaceId, kind: "member_role_assignment", id: userId });
        const body = { userId, binding: command.binding, assignedByUserId: actor.userId, assignedAt: now.toISOString() };
        const projectionRole = command.binding.kind === "built_in" && command.binding.role === "admin" ? "admin" : "member";
        mutations = [
          current ? update(current, "active", body) : create("member_role_assignment", userId, "active", body),
          create("membership_projection", newId("membership_projection"), "queued", { operation: "update_role", userId, role: projectionRole, requestedAt: now.toISOString(), attempts: 0 }),
        ];
        canonicalEffects = [{ type: "membership_role_update", workspaceId: actor.workspaceId, userId, role: projectionRole, occurredAt: now }];
        result = { userId, binding: command.binding };
        target = { kind: "member_role_assignment", id: userId };
        break;
      }
      case "create_invitation": {
        const email = command.email.trim().toLowerCase();
        if (!/^\S+@\S+\.\S+$/.test(email)) throw new GovernanceError("INVALID_INPUT", "Email is invalid.");
        await this.validateRoleBinding(actor.workspaceId, command.binding);
        if (command.binding.kind === "built_in" && command.binding.role === "owner") throw new GovernanceError("INVALID_INPUT", "Owner may only change through the ownership-transfer lifecycle.");
        const expiry = exactDate(command.expiresAt, "Invitation expiry");
        if (expiry <= now || expiry.getTime() - now.getTime() > 30 * 86_400_000) throw new GovernanceError("INVALID_INPUT", "Invitation expiry is outside the allowed window.");
        const id = newId("invite");
        const token = randomBytes(32).toString("base64url");
        mutations = [create("invitation_binding", id, "pending", { email, tokenDigest: secretDigest(token), binding: command.binding, expiresAt: expiry.toISOString(), acceptedAt: null, revokedAt: null })];
        result = { invitationId: id, invitationToken: encodeInvitationToken(actor.workspaceId, id, token), expiresAt: expiry.toISOString() };
        target = { kind: "invitation_binding", id };
        break;
      }
      case "revoke_invitation": {
        const invitation = await this.required("invitation_binding", command.invitationId, actor.workspaceId);
        if (invitation.status !== "pending") throw new GovernanceError("CONFLICT", "Only a pending invitation may be revoked.");
        mutations = [update(invitation, "revoked", { ...invitation.body, revokedAt: now.toISOString() })];
        result = { invitationId: invitation.id, revoked: true };
        target = { kind: invitation.kind, id: invitation.id };
        break;
      }
      case "remove_member": {
        const userId = safeId(command.userId, "User");
        const removed = await this.memberships.removeMembership({ workspaceId: actor.workspaceId, userId });
        if (removed === "owner_forbidden") throw new GovernanceError("FORBIDDEN", "Transfer ownership before removing the Workspace Owner.");
        if (removed === "not_found") throw new GovernanceError("NOT_FOUND", "Workspace member unavailable.");
        const assignment = await this.repository.getResource({ workspaceId: actor.workspaceId, kind: "member_role_assignment", id: userId });
        const projection = create("membership_projection", newId("membership_projection"), "queued", { operation: "remove", userId, requestedAt: now.toISOString(), attempts: 0 });
        mutations = [...(assignment ? [update(assignment, "revoked", { ...assignment.body, revokedAt: now.toISOString() })] : []), projection];
        canonicalEffects = [{ type: "membership_remove", workspaceId: actor.workspaceId, userId, occurredAt: now }];
        result = { userId, removed: true };
        target = { kind: "workspace_member", id: userId };
        break;
      }
      case "transfer_ownership": {
        if (actor.legacyRole !== "owner") throw new GovernanceError("FORBIDDEN", "Only the current Workspace Owner may transfer ownership.");
        const newOwnerUserId = safeId(command.newOwnerUserId, "New Owner");
        if (newOwnerUserId === actor.userId) throw new GovernanceError("INVALID_INPUT", "The new Owner must be another current member.");
        await this.requireStepUp(actor, "workspace.transfer_ownership", newOwnerUserId, command.stepUpToken);
        const transferred = await this.memberships.transferOwnership({ workspaceId: actor.workspaceId, currentOwnerUserId: actor.userId, newOwnerUserId });
        if (transferred === "target_not_member") throw new GovernanceError("NOT_FOUND", "The new Owner must be a current Workspace member.");
        if (transferred === "not_current_owner") throw new GovernanceError("FORBIDDEN", "Ownership changed before this transfer completed.");
        const oldAssignment = await this.repository.getResource({ workspaceId: actor.workspaceId, kind: "member_role_assignment", id: actor.userId });
        const newAssignment = await this.repository.getResource({ workspaceId: actor.workspaceId, kind: "member_role_assignment", id: newOwnerUserId });
        const oldBody = { userId: actor.userId, binding: { kind: "built_in" as const, role: "admin" as const }, assignedByUserId: actor.userId, assignedAt: now.toISOString(), ownershipTransfer: true };
        const newBody = { userId: newOwnerUserId, binding: { kind: "built_in" as const, role: "owner" as const }, assignedByUserId: actor.userId, assignedAt: now.toISOString(), ownershipTransfer: true };
        mutations = [oldAssignment ? update(oldAssignment, "active", oldBody) : create("member_role_assignment", actor.userId, "active", oldBody), newAssignment ? update(newAssignment, "active", newBody) : create("member_role_assignment", newOwnerUserId, "active", newBody)];
        mutations.push(create("membership_projection", newId("membership_projection"), "queued", { operation: "transfer_ownership", currentOwnerUserId: actor.userId, newOwnerUserId, requestedAt: now.toISOString(), attempts: 0 }));
        canonicalEffects = [{ type: "ownership_transfer", workspaceId: actor.workspaceId, currentOwnerUserId: actor.userId, newOwnerUserId, occurredAt: now }];
        result = { previousOwnerUserId: actor.userId, newOwnerUserId, transferred: true };
        target = { kind: "workspace", id: actor.workspaceId };
        break;
      }
      case "request_workspace_closure": {
        if (actor.legacyRole !== "owner") throw new GovernanceError("FORBIDDEN", "Only the Workspace Owner may request closure.");
        if (!Number.isInteger(command.coolingOffDays) || command.coolingOffDays < 7 || command.coolingOffDays > 30) throw new GovernanceError("INVALID_INPUT", "Closure cooling-off must be between 7 and 30 days.");
        await this.requireStepUp(actor, "workspace.close", null, command.stepUpToken);
        const pending = await this.repository.listResources({ workspaceId: actor.workspaceId, kinds: ["workspace_closure"], status: "cooling_off" });
        if (pending.length) throw new GovernanceError("CONFLICT", "A Workspace closure is already cooling off.");
        const id = newId("closure");
        const executeAfter = new Date(now.getTime() + command.coolingOffDays * 86_400_000).toISOString();
        mutations = [create("workspace_closure", id, "cooling_off", { reason: text(command.reason, "Closure reason", 1000), requestedByUserId: actor.userId, requestedAt: now.toISOString(), executeAfter, cancelledAt: null, executedAt: null })];
        result = { closureId: id, status: "cooling_off", executeAfter };
        target = { kind: "workspace_closure", id };
        break;
      }
      case "cancel_workspace_closure": {
        const closure = await this.required("workspace_closure", command.closureId, actor.workspaceId);
        if (closure.status !== "cooling_off") throw new GovernanceError("CONFLICT", "Only a cooling-off closure may be cancelled.");
        mutations = [update(closure, "cancelled", { ...closure.body, cancelledAt: now.toISOString() })];
        result = { closureId: closure.id, status: "cancelled" };
        target = { kind: closure.kind, id: closure.id };
        break;
      }
      case "execute_workspace_closure": {
        if (actor.legacyRole !== "owner") throw new GovernanceError("FORBIDDEN", "Only the Workspace Owner may complete closure.");
        const closure = await this.required("workspace_closure", command.closureId, actor.workspaceId);
        const closureBody = closure.body as { executeAfter: string; [key: string]: unknown };
        if (closure.status !== "cooling_off") throw new GovernanceError("CONFLICT", "Workspace closure is not pending.");
        if (exactDate(closureBody.executeAfter, "Closure execution time") > now) throw new GovernanceError("CONFLICT", "Workspace closure is still cooling off.");
        await this.requireStepUp(actor, "workspace.close", closure.id, command.stepUpToken);
        const closed = await this.memberships.closeWorkspace({ workspaceId: actor.workspaceId, currentOwnerUserId: actor.userId, closedAt: now });
        if (closed === "not_current_owner") throw new GovernanceError("FORBIDDEN", "Only the current Workspace Owner may complete closure.");
        mutations = [
          update(closure, "closed", { ...closureBody, executedAt: now.toISOString() }),
          create("membership_projection", newId("membership_projection"), "queued", { operation: "close_workspace", requestedAt: now.toISOString(), attempts: 0 }),
        ];
        canonicalEffects = [{ type: "workspace_close", workspaceId: actor.workspaceId, currentOwnerUserId: actor.userId, occurredAt: now }];
        result = { closureId: closure.id, status: "closed", closedAt: now.toISOString() };
        target = { kind: closure.kind, id: closure.id };
        break;
      }
      case "create_portfolio": {
        const id = newId("portfolio");
        mutations = [create("portfolio", id, "active", { name: text(command.name, "Portfolio name", 120), workspaceIds: [actor.workspaceId] })];
        result = { portfolioId: id };
        target = { kind: "portfolio", id };
        break;
      }
      case "assign_portfolio": {
        const portfolio = await this.repository.getResource({ workspaceId: actor.workspaceId, kind: "portfolio", id: safeId(command.portfolioId, "Portfolio") });
        if (!portfolio) throw new GovernanceError("NOT_FOUND", "Portfolio unavailable.");
        const assigneeUserId = safeId(command.assigneeUserId, "Assignee");
        const targetWorkspaceId = safeId(command.targetWorkspaceId, "Target Workspace");
        const capabilityAllowlist = unique(command.capabilityAllowlist.map((item) => text(item, "Allowed capability", 200))).sort();
        const resourceAllowlist = command.resourceAllowlist.map((item) => ({ kind: text(item.kind, "Allowed resource kind", 100), id: safeId(item.id, "Allowed resource") }));
        if (!command.permissions.includes("bulk") || !capabilityAllowlist.length || !resourceAllowlist.length) throw new GovernanceError("INVALID_INPUT", "Bulk Portfolio assignments require exact capability and resource allowlists.");
        const expiresAt = command.expiresAt ? exactDate(command.expiresAt, "Assignment expiry") : null;
        if (expiresAt && expiresAt <= now) throw new GovernanceError("INVALID_INPUT", "Assignment expiry must be in the future.");
        const id = `${command.portfolioId}:${assigneeUserId}:${targetWorkspaceId}`;
        mutations = [create("portfolio_assignment", id, "active", { portfolioId: command.portfolioId, assigneeUserId, sourceWorkspaceId: actor.workspaceId, targetWorkspaceId, permissions: unique(command.permissions), capabilityAllowlist, resourceAllowlist, expiresAt: expiresAt?.toISOString() ?? null, revokedAt: null, grantsNoAuthority: true })];
        result = { assignmentId: id, targetWorkspaceId: command.targetWorkspaceId };
        target = { kind: "portfolio_assignment", id };
        break;
      }
      case "revoke_portfolio_assignment": {
        const assignment = await this.required("portfolio_assignment", command.assignmentId, actor.workspaceId);
        if (assignment.status !== "active") throw new GovernanceError("CONFLICT", "Portfolio assignment is not active.");
        mutations = [update(assignment, "revoked", { ...assignment.body, revokedAt: now.toISOString() })];
        result = { assignmentId: assignment.id, revoked: true };
        target = { kind: assignment.kind, id: assignment.id };
        break;
      }
      case "issue_review_guest": {
        const expiry = exactDate(command.expiresAt, "Guest expiry");
        if (expiry <= now || expiry.getTime() - now.getTime() > MAX_GUEST_LIFETIME_MS || !SHA256.test(command.revisionDigest)) throw new GovernanceError("INVALID_INPUT", "Guest scope or expiry is invalid.");
        const id = newId("review");
        const token = randomBytes(32).toString("base64url");
        const code = String(randomInt(100000, 1_000_000));
        const salt = randomBytes(16).toString("hex");
        mutations = [create("review_guest_grant", id, "pending_verification", { email: command.email.trim().toLowerCase(), tokenDigest: secretDigest(token), codeDigest: codeDigest(code, salt), codeSalt: salt, failedAttempts: 0, purpose: command.purpose, resourceKind: command.resourceKind, resourceId: safeId(command.resourceId, "Review resource"), revisionDigest: command.revisionDigest, expiresAt: expiry.toISOString(), revokedAt: null, decision: null })];
        result = { grantId: id, reviewToken: encodeReviewToken(actor.workspaceId, id, token), verificationCode: code, expiresAt: expiry.toISOString() };
        target = { kind: "review_guest_grant", id };
        break;
      }
      case "revoke_review_guest": {
        const current = await this.required("review_guest_grant", command.grantId, actor.workspaceId);
        mutations = [update(current, "revoked", { ...current.body, revokedAt: now.toISOString() })];
        result = { grantId: current.id, revoked: true };
        target = { kind: current.kind, id: current.id };
        break;
      }
      case "publish_approval_policy": {
        this.validateApprovalPolicy(command.policy);
        const id = command.policyId ? safeId(command.policyId, "Policy") : newId("approval_policy");
        const current = command.policyId ? await this.repository.getResource<{ revisions: ApprovalPolicyRevision[] }>({ workspaceId: actor.workspaceId, kind: "approval_policy", id }) : null;
        if (current && command.expectedVersion !== current.version) throw new GovernanceError("CONFLICT", "Approval Policy changed.");
        const revision: ApprovalPolicyRevision = { schema: "approval-policy-revision/v1", ...command.policy, revision: (current?.body.revisions.length ?? 0) + 1, createdByUserId: actor.userId, createdAt: now.toISOString() };
        const body = { revisions: [...(current?.body.revisions ?? []), revision], activeRevision: revision.revision };
        mutations = [current ? update(current, "active", body) : create("approval_policy", id, "active", body)];
        result = { policyId: id, revision };
        target = { kind: "approval_policy", id };
        break;
      }
      case "request_content_acceptance": {
        if (!SHA256.test(command.revisionDigest)) throw new GovernanceError("INVALID_INPUT", "Content Acceptance revision digest is invalid.");
        const policyResource = await this.required("approval_policy", command.policyId, actor.workspaceId);
        const revision = (policyResource.body as { revisions: ApprovalPolicyRevision[] }).revisions.find((candidate) => candidate.revision === command.policyRevision);
        if (!revision || revision.purpose !== "content_acceptance") throw new GovernanceError("NOT_FOUND", "The exact Content Acceptance policy revision is unavailable.");
        const id = newId("content_acceptance");
        const progress = createContentAcceptanceProgress({ policy: revision, requesterUserId: actor.userId, now });
        mutations = [create("approval_request", id, progress.status, { policyId: policyResource.id, policyRevision: revision.revision, policySnapshot: revision, resourceKind: text(command.resourceKind, "Resource kind", 100), resourceId: safeId(command.resourceId, "Resource"), revisionDigest: command.revisionDigest, progress })];
        result = { requestId: id, purpose: "content_acceptance", status: progress.status, deadlineAt: progress.deadlineAt, expiresAt: progress.expiresAt, authorizesExecution: false };
        target = { kind: "approval_request", id };
        break;
      }
      case "decide_content_acceptance": {
        const request = await this.required("approval_request", command.requestId, actor.workspaceId);
        const body = request.body as { policySnapshot: ApprovalPolicyRevision; progress: import("./types").ContentAcceptanceProgress; [key: string]: unknown };
        const binding = await this.roleBinding(actor);
        const roleId = binding.kind === "built_in" ? binding.role : binding.roleId;
        let progress;
        try { progress = decideContentAcceptance({ policy: body.policySnapshot, progress: body.progress, userId: actor.userId, roleId, decision: command.decision, now }); }
        catch (error) { if (error instanceof ApprovalPolicyError) throw new GovernanceError("FORBIDDEN", error.message); throw error; }
        mutations = [update(request, progress.status, { ...body, progress })];
        result = { requestId: request.id, purpose: "content_acceptance", status: progress.status, decision: command.decision, revisionDigest: body.revisionDigest, authorizesExecution: false };
        target = { kind: request.kind, id: request.id };
        break;
      }
      case "advance_content_acceptance": {
        const request = await this.required("approval_request", command.requestId, actor.workspaceId);
        const body = request.body as { policySnapshot: ApprovalPolicyRevision; progress: import("./types").ContentAcceptanceProgress; [key: string]: unknown };
        const progress = advanceApprovalDeadline({ policy: body.policySnapshot, progress: body.progress, now });
        if (progress === body.progress) throw new GovernanceError("CONFLICT", "Content Acceptance deadline has not changed state.");
        mutations = [update(request, progress.status, { ...body, progress })];
        result = { requestId: request.id, purpose: "content_acceptance", status: progress.status, authorizesExecution: false };
        target = { kind: request.kind, id: request.id };
        break;
      }
      case "begin_step_up": {
        const id = newId("stepup_challenge");
        const code = String(randomInt(100000, 1_000_000));
        const salt = randomBytes(16).toString("hex");
        const expiresAt = new Date(now.getTime() + 10 * 60_000);
        mutations = [create("step_up_challenge", id, "pending", { userId: actor.userId, purpose: text(command.purpose, "Purpose", 120), resourceId: command.resourceId ? safeId(command.resourceId, "Resource") : null, codeDigest: codeDigest(code, salt), codeSalt: salt, attempts: 0, expiresAt: expiresAt.toISOString() })];
        result = { challengeId: id, verificationCode: code, expiresAt: expiresAt.toISOString() };
        target = { kind: "step_up_challenge", id };
        break;
      }
      case "verify_step_up": {
        const challenge = await this.required("step_up_challenge", command.challengeId, actor.workspaceId);
        const body = challenge.body as { userId: string; purpose: string; resourceId: string | null; codeDigest: string; codeSalt: string; attempts: number; expiresAt: string };
        if (challenge.status !== "pending" || body.userId !== actor.userId || exactDate(body.expiresAt, "Challenge expiry") <= now) throw new GovernanceError("EXPIRED", "Step-up challenge expired.");
        if (body.attempts >= 5 || !codeMatches(command.code, body.codeSalt, body.codeDigest)) {
          mutations = [update(challenge, body.attempts >= 4 ? "locked" : "pending", { ...body, attempts: body.attempts + 1 })];
          result = { verified: false, attemptsRemaining: Math.max(0, 4 - body.attempts) };
          target = { kind: challenge.kind, id: challenge.id };
          break;
        }
        const id = newId("stepup_session");
        const token = randomBytes(32).toString("base64url");
        const expiresAt = new Date(Math.min(now.getTime() + MAX_STEP_UP_LIFETIME_MS, exactDate(body.expiresAt, "Challenge expiry").getTime()));
        mutations = [update(challenge, "verified", { ...body, verifiedAt: now.toISOString() }), create("step_up_session", id, "active", { tokenDigest: secretDigest(token), userId: actor.userId, purpose: body.purpose, resourceId: body.resourceId, expiresAt: expiresAt.toISOString() })];
        result = { verified: true, stepUpToken: token, expiresAt: expiresAt.toISOString() };
        target = { kind: "step_up_session", id };
        break;
      }
      case "request_audit_export": {
        await this.requireStepUp(actor, "audit.export", null, command.stepUpToken);
        const id = newId("audit_export");
        mutations = [create("audit_export", id, "queued", await this.exportJobBody(actor, "audit", command.from, command.to, now, { from: command.from, to: command.to }))];
        result = { exportId: id, status: "queued" };
        target = { kind: "audit_export", id };
        break;
      }
      case "set_region_policy": {
        await this.requireStepUp(actor, "regions.manage", null, command.stepUpToken);
        const id = "active";
        const current = await this.repository.getResource({ workspaceId: actor.workspaceId, kind: "data_region_policy", id });
        if (current && command.expectedVersion !== current.version) throw new GovernanceError("CONFLICT", "Region policy changed.");
        const verification = await this.regionVerification.verify({ workspaceId: actor.workspaceId, region: safeId(command.region, "Region"), evidence: command.verificationEvidence, evaluatedAt: now });
        const body = verification.status === "verified"
          ? { region: command.region, verified: true, verifiedEvidence: verification.evidence, verificationFailureReason: null, pinnedAt: now.toISOString(), incompatibleRoutesExcluded: true }
          : { region: command.region, verified: false, verifiedEvidence: null, verificationFailureReason: verification.reason, pinnedAt: now.toISOString(), incompatibleRoutesExcluded: false };
        const status = verification.status === "verified" ? "active" : "pending_verification";
        mutations = [current ? update(current, status, body) : create("data_region_policy", id, status, body)];
        result = { policyId: id, region: command.region, verified: verification.status === "verified", status, ...(verification.status === "pending" ? { reason: verification.reason } : { evidenceDigest: verification.evidence.evidenceDigest }) };
        target = { kind: "data_region_policy", id };
        break;
      }
      case "publish_retention_policy": {
        await this.requireStepUp(actor, "retention.manage", null, command.stepUpToken);
        this.validateRetention(command.rules);
        const id = "active";
        const current = await this.repository.getResource<{ revisions: unknown[] }>({ workspaceId: actor.workspaceId, kind: "retention_policy", id });
        if (current && command.expectedVersion !== current.version) throw new GovernanceError("CONFLICT", "Retention Policy changed.");
        const revision = { schema: "retention-policy-revision/v1", revision: (current?.body.revisions.length ?? 0) + 1, rules: command.rules, createdByUserId: actor.userId, createdAt: now.toISOString() };
        const body = { revisions: [...(current?.body.revisions ?? []), revision], activeRevision: revision.revision };
        mutations = [current ? update(current, "active", body) : create("retention_policy", id, "active", body)];
        result = { policyId: id, revision };
        target = { kind: "retention_policy", id };
        break;
      }
      case "create_retention_hold": {
        await this.requireStepUp(actor, "retention.manage", null, command.stepUpToken);
        const classes = unique(command.retentionClasses);
        if (!classes.length || classes.some((item) => !(RETENTION_CLASSES as readonly string[]).includes(item))) throw new GovernanceError("INVALID_INPUT", "Retention hold classes are invalid.");
        const id = newId("hold");
        mutations = [create("retention_hold", id, "active", { retentionClasses: classes, reason: text(command.reason, "Hold reason", 500), expiresAt: command.expiresAt ? exactDate(command.expiresAt, "Hold expiry").toISOString() : null, releasedAt: null })];
        result = { holdId: id, status: "active" };
        target = { kind: "retention_hold", id };
        break;
      }
      case "release_retention_hold": {
        const hold = await this.required("retention_hold", command.holdId, actor.workspaceId);
        if (hold.status !== "active") throw new GovernanceError("CONFLICT", "Retention hold is not active.");
        await this.requireStepUp(actor, "retention.hold.release", hold.id, command.stepUpToken);
        mutations = [update(hold, "released", { ...hold.body, releaseReason: text(command.reason, "Release reason", 1000), releasedAt: now.toISOString(), releasedByUserId: actor.userId })];
        result = { holdId: hold.id, status: "released" };
        target = { kind: hold.kind, id: hold.id };
        break;
      }
      case "record_deletion": {
        if (!(RETENTION_CLASSES as readonly string[]).includes(command.retentionClass)) throw new GovernanceError("INVALID_INPUT", "Deletion Retention Class is invalid.");
        await this.requireStepUp(actor, "retention.delete", safeId(command.resourceId, "Resource"), command.stepUpToken);
        const activeHolds = await this.repository.listResources<{ retentionClasses: string[]; expiresAt: string | null }>({ workspaceId: actor.workspaceId, kinds: ["retention_hold"], status: "active" });
        const applicableHolds = activeHolds.filter((hold) => hold.body.retentionClasses.includes(command.retentionClass) && (!hold.body.expiresAt || exactDate(hold.body.expiresAt, "Hold expiry") > now));
        const systems = unique(command.systems.map((item) => text(item, "Deletion system", 120))).sort();
        if (!systems.length) throw new GovernanceError("INVALID_INPUT", "At least one authoritative deletion system is required.");
        const id = newId("deletion");
        const receiptBody = { schema: "deletion-receipt/v2", retentionClass: command.retentionClass, resourceKind: text(command.resourceKind, "Resource kind", 100), resourceId: safeId(command.resourceId, "Resource"), systems, outcomes: Object.fromEntries(applicableHolds.length ? systems.map((system) => [system, { state: "retained", evidenceRef: applicableHolds.map((hold) => hold.id).join(","), reason: "ACTIVE_RETENTION_HOLD" }]) : []), holdIds: applicableHolds.map((hold) => hold.id), requestedAt: now.toISOString() };
        const tombstoneId = `${receiptBody.resourceKind}:${receiptBody.resourceId}`;
        mutations = [create("deletion_receipt", id, applicableHolds.length ? "completed_hold" : "queued", receiptBody)];
        if (applicableHolds.length) mutations.push(create("tombstone", tombstoneId, "active", { resourceKind: receiptBody.resourceKind, resourceId: receiptBody.resourceId, deletionReceiptId: id, systemOutcomes: receiptBody.outcomes, retainedEvidenceOnly: true }));
        result = { deletionReceiptId: id, status: applicableHolds.length ? "completed_hold" : "queued", tombstoneId: applicableHolds.length ? tombstoneId : null };
        target = { kind: "deletion_receipt", id };
        break;
      }
      case "create_safety_decision": {
        const id = newId("safety_decision");
        mutations = [create("safety_decision", id, "active", { ...command, intentRef: safeId(command.intentRef, "Intent"), reasonCode: text(command.reasonCode, "Reason code", 100), policyVersion: text(command.policyVersion, "Policy version", 100), safeExplanation: text(command.safeExplanation, "Safe explanation", 1000), evidenceRef: safeId(command.evidenceRef, "Evidence"), remediation: text(command.remediation, "Remediation", 1000), detectionInternalsExposed: false })];
        result = { decisionId: id, appealEligible: command.appealEligible };
        target = { kind: "safety_decision", id };
        break;
      }
      case "appeal_safety_decision": {
        const decision = await this.required("safety_decision", command.decisionId, actor.workspaceId);
        if (!(decision.body as { appealEligible?: boolean }).appealEligible) throw new GovernanceError("FORBIDDEN", "This decision is not appealable.");
        const id = newId("safety_appeal");
        mutations = [create("safety_appeal", id, "pending", { decisionId: decision.id, intentRef: (decision.body as { intentRef: string }).intentRef, explanation: text(command.explanation, "Appeal", 2000), outcome: null, canBypassPolicy: false })];
        result = { appealId: id, status: "pending" };
        target = { kind: "safety_appeal", id };
        break;
      }
      case "resolve_safety_appeal": {
        const appeal = await this.required("safety_appeal", command.appealId, actor.workspaceId);
        if (appeal.status !== "pending") throw new GovernanceError("CONFLICT", "Appeal is already resolved.");
        const revalidate = command.outcome === "reevaluate_exact_intent";
        const status = revalidate ? "revalidation_queued" : "resolved_upheld";
        mutations = [update(appeal, status, { ...appeal.body, outcome: command.outcome, resolvedAt: revalidate ? null : now.toISOString(), currentRevalidationRequired: revalidate, canBypassPolicy: false, canResume: false, revalidation: null })];
        result = { appealId: appeal.id, outcome: command.outcome, status, currentRevalidationRequired: revalidate, canResume: false };
        target = { kind: appeal.kind, id: appeal.id };
        break;
      }
      case "preview_bulk": {
        if (command.items.length < 1 || command.items.length > 1000 || command.concurrency < 1 || command.concurrency > 20) throw new GovernanceError("INVALID_INPUT", "Bulk bounds are invalid.");
        if (!/^[a-z][a-z0-9_.]*@[1-9][0-9]*$/.test(command.operationCapability) || command.operationCapability === "bulk.execute@1") throw new GovernanceError("INVALID_INPUT", "Bulk Application Capability is invalid.");
        const id = newId("bulk");
        const items: BulkOperationItem[] = command.items.map((item, index) => ({ id: `${id}:${index + 1}`, targetWorkspaceId: safeId(item.targetWorkspaceId, "Target Workspace"), targetKind: text(item.targetKind, "Target kind", 100), targetId: safeId(item.targetId, "Target"), capability: command.operationCapability, input: item.input ?? { targetKind: item.targetKind, targetId: item.targetId }, idempotencyKey: `${id}:${index + 1}`, state: "previewed", outcome: null }));
        mutations = [create("bulk_operation", id, "previewed", { capability: command.operationCapability, dryRun: true, concurrency: command.concurrency, quoteRef: command.quoteRef, requestedByUserId: actor.userId, items, cancellationRequestedAt: null })];
        result = { operationId: id, dryRun: true, itemCount: items.length };
        target = { kind: "bulk_operation", id };
        break;
      }
      case "start_bulk": {
        const operation = await this.required("bulk_operation", command.operationId, actor.workspaceId);
        const body = operation.body as { capability: string; items: BulkOperationItem[]; [key: string]: unknown };
        if (operation.status !== "previewed") throw new GovernanceError("CONFLICT", "Only a previewed Bulk Operation may start.");
        if (body.capability.includes("publish") || body.capability.includes("release")) {
          if (!command.stepUpToken) throw new GovernanceError("STEP_UP_REQUIRED", "Bulk public release requires step-up.");
          await this.requireStepUp(actor, "bulk.public_release", operation.id, command.stepUpToken);
        }
        mutations = [update(operation, "queued", { ...body, dryRun: false, items: body.items.map((item) => ({ ...item, state: "queued" })) })];
        result = { operationId: operation.id, status: "queued" };
        target = { kind: operation.kind, id: operation.id };
        break;
      }
      case "cancel_bulk": {
        const operation = await this.required("bulk_operation", command.operationId, actor.workspaceId);
        if (["succeeded", "cancelled"].includes(operation.status)) throw new GovernanceError("CONFLICT", "Bulk Operation is terminal.");
        mutations = [update(operation, "cancelling", { ...operation.body, cancellationRequestedAt: now.toISOString() })];
        result = { operationId: operation.id, status: "cancelling" };
        target = { kind: operation.kind, id: operation.id };
        break;
      }
      case "retry_bulk_item": {
        const operation = await this.required("bulk_operation", command.operationId, actor.workspaceId);
        const body = operation.body as { items: BulkOperationItem[]; [key: string]: unknown };
        const item = body.items.find((candidate) => candidate.id === command.itemId);
        if (!item) throw new GovernanceError("NOT_FOUND", "Bulk item unavailable.");
        if (item.state === "outcome_unknown") throw new GovernanceError("UNSAFE_RETRY", "Ambiguous effects require reconciliation, not retry.");
        if (item.state !== "failed_known") throw new GovernanceError("CONFLICT", "Only known failed items may retry.");
        mutations = [update(operation, "queued", { ...body, items: body.items.map((candidate) => candidate.id === item.id ? { ...candidate, state: "queued", outcome: null } : candidate) })];
        result = { operationId: operation.id, itemId: item.id, status: "queued" };
        target = { kind: operation.kind, id: operation.id };
        break;
      }
      case "preview_import": {
        if (!SHA256.test(command.sourceManifestDigest) || !command.items.length) throw new GovernanceError("INVALID_INPUT", "Import manifest is invalid.");
        const id = `import_${canonicalDigest({ source: command.source, digest: command.sourceManifestDigest }).slice(7, 39)}`;
        const items = command.items.map((item, index) => {
          if (!item.transferable && !item.omissionReason) throw new GovernanceError("INVALID_INPUT", "Every omitted import item requires an explicit reason.");
          if (item.transferable && (!item.payload || canonicalDigest(item.payload) !== item.digest)) throw new GovernanceError("INVALID_INPUT", "Transferable import payload does not match its signed digest.");
          return { ...item, id: `${id}:${index + 1}`, sourceId: safeId(item.sourceId, "Source item"), destinationId: item.destinationId ? safeId(item.destinationId, "Destination item") : undefined, digest: SHA256.test(item.digest) ? item.digest : (() => { throw new GovernanceError("INVALID_INPUT", "Import item digest is invalid."); })(), action: item.transferable ? "create_or_match" : "omit", state: item.transferable ? "previewed" : "omitted", outcome: item.transferable ? null : { omissionReason: text(item.omissionReason!, "Omission reason", 500) }, provenancePreserved: true };
        });
        mutations = [create("workspace_import", id, "previewed", { source: text(command.source, "Import source", 300), sourceManifestDigest: command.sourceManifestDigest, dryRun: true, items })];
        result = { importId: id, dryRun: true, items };
        target = { kind: "workspace_import", id };
        break;
      }
      case "execute_import": {
        const imported = await this.required("workspace_import", command.importId, actor.workspaceId);
        if (imported.status !== "previewed") throw new GovernanceError("CONFLICT", "Import is not previewable.");
        const importBody = imported.body as { items: Array<{ state: string; [key: string]: unknown }>; [key: string]: unknown };
        mutations = [update(imported, "queued", { ...importBody, dryRun: false, queuedAt: now.toISOString(), requestedByUserId: actor.userId, items: importBody.items.map((item) => item.state === "previewed" ? { ...item, state: "queued" } : item) })];
        result = { importId: imported.id, status: "queued" };
        target = { kind: imported.kind, id: imported.id };
        break;
      }
      case "request_workspace_export": {
        await this.requireStepUp(actor, "exports.manage", null, command.stepUpToken);
        const id = newId("workspace_export");
        const omissions = ["secrets", "credential_material", "non_transferable_licensed_media", "legally_retained_internal_evidence"];
        const includeKinds = unique(command.includeKinds.map((item) => text(item, "Export kind", 100)));
        mutations = [create("workspace_export", id, "queued", { ...await this.exportJobBody(actor, "workspace", null, null, now, { includeKinds }), includeKinds, omissions })];
        result = { exportId: id, status: "queued", omissions };
        target = { kind: "workspace_export", id };
        break;
      }
    }

    return this.commit({ actor, command, capability, idempotencyKey, mutations, result, target, now, canonicalEffects });
  }

  /** Resolve and verify a guest grant without creating Workspace browsing authority. */
  async verifyReviewGuest(input: {
    workspaceId: string;
    grantId: string;
    token: string;
    code: string;
    idempotencyKey: string;
  }): Promise<unknown> {
    const now = this.clock.now();
    const receiptCapability = "review_guests.verify@1";
    const request = { grantId: input.grantId, tokenDigest: secretDigest(input.token), codeDigest: secretDigest(input.code) };
    const replay = await this.preflight({
      workspaceId: input.workspaceId,
      capability: receiptCapability,
      idempotencyKey: input.idempotencyKey,
      requestDigest: canonicalDigest(request),
    });
    if (replay !== undefined) return replay;
    const grant = await this.required("review_guest_grant", input.grantId, input.workspaceId);
    const body = grant.body as {
      email: string; tokenDigest: string; codeDigest: string; codeSalt: string;
      failedAttempts: number; purpose: string; resourceKind: string; resourceId: string;
      revisionDigest: string; expiresAt: string; revokedAt: string | null; decision: unknown;
    };
    if (grant.status === "revoked" || body.revokedAt || exactDate(body.expiresAt, "Review expiry") <= now) {
      throw new GovernanceError("EXPIRED", "Review grant expired or was revoked.");
    }
    if (secretDigest(input.token) !== body.tokenDigest) throw new GovernanceError("NOT_FOUND", "Review grant unavailable.");
    const verified = body.failedAttempts < 5 && codeMatches(input.code, body.codeSalt, body.codeDigest);
    if (!verified) {
      const next = resource({ id: grant.id, workspaceId: grant.workspaceId, kind: grant.kind, version: grant.version + 1, status: body.failedAttempts >= 4 ? "locked" : grant.status, body: { ...body, failedAttempts: body.failedAttempts + 1 }, actor: grant.createdByUserId, createdAt: grant.createdAt, now });
      const result = { verified: false, attemptsRemaining: Math.max(0, 4 - body.failedAttempts) };
      const outcome = await this.repository.commit({ receipt: { workspaceId: input.workspaceId, capability: receiptCapability, idempotencyKey: input.idempotencyKey, requestDigest: canonicalDigest(request), result, createdAt: now }, mutations: [{ type: "update", expectedVersion: grant.version, resource: next }], audit: { schema: "workspace-audit-event/v1", id: newId("audit"), workspaceId: input.workspaceId, actor: { kind: "review_guest", id: grant.id }, capability: receiptCapability, action: "verify", resource: { kind: grant.kind, id: grant.id }, outcome: "denied", redactedDetails: {}, occurredAt: now } });
      if (outcome.type === "conflict") throw new GovernanceError("CONFLICT", "Review verification changed.");
      return outcome.type === "committed" ? result : outcome.result;
    }
    const sessionId = newId("review_session");
    const sessionToken = randomBytes(32).toString("base64url");
    const expiresAt = new Date(Math.min(now.getTime() + 60 * 60_000, exactDate(body.expiresAt, "Review expiry").getTime()));
    const session = resource({ id: sessionId, workspaceId: input.workspaceId, kind: "review_guest_session", version: 1, status: "active", body: { grantId: grant.id, tokenDigest: secretDigest(sessionToken), purpose: body.purpose, resourceKind: body.resourceKind, resourceId: body.resourceId, revisionDigest: body.revisionDigest, expiresAt: expiresAt.toISOString() }, actor: null, now });
    const result = { verified: true, sessionId, sessionToken, purpose: body.purpose, resourceKind: body.resourceKind, resourceId: body.resourceId, revisionDigest: body.revisionDigest, expiresAt: expiresAt.toISOString() };
    const outcome = await this.repository.commit({ receipt: { workspaceId: input.workspaceId, capability: receiptCapability, idempotencyKey: input.idempotencyKey, requestDigest: canonicalDigest(request), result: receiptSafeResult(result), createdAt: now }, mutations: [{ type: "create", expectedVersion: null, resource: session }], audit: { schema: "workspace-audit-event/v1", id: newId("audit"), workspaceId: input.workspaceId, actor: { kind: "review_guest", id: grant.id }, capability: receiptCapability, action: "verify", resource: { kind: grant.kind, id: grant.id }, outcome: "completed", redactedDetails: {}, occurredAt: now } });
    if (outcome.type === "conflict") throw new GovernanceError("CONFLICT", "Review verification changed.");
    return outcome.type === "committed" ? result : outcome.result;
  }

  async acceptInvitation(input: {
    workspaceId: string;
    invitationId: string;
    token: string;
    userId: string;
    verifiedEmail: string;
    idempotencyKey: string;
  }): Promise<unknown> {
    const now = this.clock.now();
    const receiptCapability = "members.invitations.accept@1";
    const requestDigest = canonicalDigest({ invitationId: input.invitationId, userId: input.userId, tokenDigest: secretDigest(input.token) });
    const replay = await this.preflight({ workspaceId: input.workspaceId, capability: receiptCapability, idempotencyKey: input.idempotencyKey, requestDigest });
    if (replay !== undefined) return replay;
    const invitation = await this.required("invitation_binding", input.invitationId, input.workspaceId);
    const body = invitation.body as { email: string; tokenDigest: string; binding: WorkspaceRoleBinding; expiresAt: string; acceptedAt: string | null; revokedAt: string | null };
    if (invitation.status !== "pending" || body.revokedAt || exactDate(body.expiresAt, "Invitation expiry") <= now) throw new GovernanceError("EXPIRED", "Invitation expired or was revoked.");
    if (secretDigest(input.token) !== body.tokenDigest || body.email !== input.verifiedEmail.trim().toLowerCase()) throw new GovernanceError("NOT_FOUND", "Invitation unavailable.");
    await this.validateRoleBinding(input.workspaceId, body.binding);
    if (body.binding.kind === "built_in" && body.binding.role === "owner") throw new GovernanceError("INVALID_INPUT", "Owner may only change through the ownership-transfer lifecycle.");
    await this.memberships.provisionAcceptedMembership({ workspaceId: input.workspaceId, userId: input.userId, binding: body.binding });
    const currentAssignment = await this.repository.getResource({ workspaceId: input.workspaceId, kind: "member_role_assignment", id: input.userId });
    const invitationNext = resource({ id: invitation.id, workspaceId: invitation.workspaceId, kind: invitation.kind, version: invitation.version + 1, status: "accepted", body: { ...body, acceptedAt: now.toISOString() }, actor: invitation.createdByUserId, createdAt: invitation.createdAt, now });
    const assignmentBody = { userId: input.userId, binding: body.binding, assignedByUserId: invitation.createdByUserId, assignedAt: now.toISOString(), sourceInvitationId: invitation.id };
    const assignmentNext = resource({ id: input.userId, workspaceId: input.workspaceId, kind: "member_role_assignment", version: (currentAssignment?.version ?? 0) + 1, status: "active", body: assignmentBody, actor: invitation.createdByUserId, createdAt: currentAssignment?.createdAt, now });
    const projection = resource({ id: newId("membership_projection"), workspaceId: input.workspaceId, kind: "membership_projection", version: 1, status: "queued", body: { operation: "upsert", userId: input.userId, role: body.binding.kind === "built_in" && body.binding.role === "admin" ? "admin" : "member", requestedAt: now.toISOString(), attempts: 0 }, actor: invitation.createdByUserId, now });
    const result = { invitationId: invitation.id, workspaceId: input.workspaceId, userId: input.userId, binding: body.binding, accepted: true };
    const outcome = await this.repository.commit({ receipt: { workspaceId: input.workspaceId, capability: receiptCapability, idempotencyKey: input.idempotencyKey, requestDigest, result, createdAt: now }, mutations: [{ type: "update", expectedVersion: invitation.version, resource: invitationNext }, { type: currentAssignment ? "update" : "create", expectedVersion: currentAssignment?.version ?? null, resource: assignmentNext }, { type: "create", expectedVersion: null, resource: projection }], canonicalEffects: [{ type: "membership_upsert", workspaceId: input.workspaceId, userId: input.userId, role: body.binding.kind === "built_in" && body.binding.role === "admin" ? "admin" : "member", occurredAt: now }], audit: { schema: "workspace-audit-event/v1", id: newId("audit"), workspaceId: input.workspaceId, actor: { kind: "human", id: input.userId }, capability: receiptCapability, action: "accept_invitation", resource: { kind: "invitation_binding", id: invitation.id }, outcome: "completed", redactedDetails: { roleBindingKind: body.binding.kind }, occurredAt: now } });
    if (outcome.type === "conflict") throw new GovernanceError("CONFLICT", "Invitation acceptance changed.");
    return outcome.type === "committed" ? result : outcome.result;
  }

  /** Guest decisions bind one immutable revision and never become execution authority. */
  async decideReviewGuest(input: {
    workspaceId: string;
    grantId: string;
    sessionId: string;
    sessionToken: string;
    resourceId: string;
    revisionDigest: string;
    decision: "comment" | "accept" | "approve" | "reject";
    comment: string | null;
    idempotencyKey: string;
  }): Promise<unknown> {
    const now = this.clock.now();
    const requestDigest = canonicalDigest({ ...input, sessionToken: "[redacted]" });
    const contentReceipt = await this.preflight({ workspaceId: input.workspaceId, capability: "reviews.decide_content@1", idempotencyKey: input.idempotencyKey, requestDigest });
    if (contentReceipt !== undefined) return contentReceipt;
    const publishingReceipt = await this.preflight({ workspaceId: input.workspaceId, capability: "reviews.decide_publishing@1", idempotencyKey: input.idempotencyKey, requestDigest });
    if (publishingReceipt !== undefined) return publishingReceipt;
    const session = await this.required("review_guest_session", input.sessionId, input.workspaceId);
    const sessionBody = session.body as { grantId: string; tokenDigest: string; purpose: string; resourceId: string; revisionDigest: string; expiresAt: string };
    if (session.status !== "active" || sessionBody.tokenDigest !== secretDigest(input.sessionToken) || exactDate(sessionBody.expiresAt, "Review session expiry") <= now) throw new GovernanceError("EXPIRED", "Review session expired.");
    if (sessionBody.resourceId !== input.resourceId || sessionBody.revisionDigest !== input.revisionDigest) throw new GovernanceError("FORBIDDEN", "Review scope does not match the exact revision.");
    if (sessionBody.grantId !== input.grantId) throw new GovernanceError("FORBIDDEN", "Review session does not match this grant.");
    const allowed: Record<string, string[]> = { inspect: [], comment: ["comment"], accept_content: ["accept", "reject", "comment"], approve_publishing: ["approve", "reject", "comment"], reject: ["reject", "comment"] };
    if (!allowed[sessionBody.purpose]?.includes(input.decision)) throw new GovernanceError("FORBIDDEN", "Decision is outside the guest purpose.");
    const grant = await this.required("review_guest_grant", sessionBody.grantId, input.workspaceId);
    const grantBody = grant.body as { revokedAt: string | null; expiresAt: string; decision: unknown; [key: string]: unknown };
    if (grant.status === "revoked" || grantBody.revokedAt || exactDate(grantBody.expiresAt, "Review expiry") <= now) throw new GovernanceError("EXPIRED", "Review grant expired or was revoked.");
    if (grantBody.decision) throw new GovernanceError("CONFLICT", "This exact review grant already has a decision.");
    const receiptCapability = sessionBody.purpose === "approve_publishing" ? "reviews.decide_publishing@1" : "reviews.decide_content@1";
    const result = { grantId: grant.id, resourceId: input.resourceId, revisionDigest: input.revisionDigest, decision: input.decision, decidedAt: now.toISOString(), authorizesExecution: false };
    const next = resource({ id: grant.id, workspaceId: grant.workspaceId, kind: grant.kind, version: grant.version + 1, status: "decided", body: { ...grantBody, decision: { ...result, comment: input.comment ? text(input.comment, "Review comment", 2000) : null } }, actor: grant.createdByUserId, createdAt: grant.createdAt, now });
    const outcome = await this.repository.commit({ receipt: { workspaceId: input.workspaceId, capability: receiptCapability, idempotencyKey: input.idempotencyKey, requestDigest, result, createdAt: now }, mutations: [{ type: "update", expectedVersion: grant.version, resource: next }], audit: { schema: "workspace-audit-event/v1", id: newId("audit"), workspaceId: input.workspaceId, actor: { kind: "review_guest", id: grant.id }, capability: receiptCapability, action: input.decision, resource: { kind: sessionBody.purpose === "approve_publishing" ? "plan_revision" : "render_proof", id: input.resourceId }, outcome: "completed", redactedDetails: { revisionDigest: input.revisionDigest, authorizesExecution: false }, occurredAt: now } });
    if (outcome.type === "conflict") throw new GovernanceError("CONFLICT", "Review decision changed.");
    return outcome.type === "committed" ? result : outcome.result;
  }

  private async required(kind: GovernanceResourceKind, id: string, workspaceId: string) {
    const item = await this.repository.getResource({ workspaceId, kind, id: safeId(id, "Resource") });
    if (!item) throw new GovernanceError("NOT_FOUND", "Resource unavailable.");
    return item;
  }

  private async validateRoleBinding(workspaceId: string, binding: WorkspaceRoleBinding) {
    if (!binding || typeof binding !== "object") throw new GovernanceError("INVALID_INPUT", "Role binding is invalid.");
    if (binding.kind === "built_in") {
      if (!(BUILT_IN_WORKSPACE_ROLES as readonly string[]).includes(binding.role)) throw new GovernanceError("INVALID_INPUT", "Built-in role is invalid.");
      return;
    }
    if (binding.kind !== "custom" || !Number.isInteger(binding.roleRevision) || binding.roleRevision < 1) throw new GovernanceError("INVALID_INPUT", "Custom Role binding is invalid.");
    const role = await this.repository.getResource<{ revisions: CustomRoleRevision[] }>({ workspaceId, kind: "custom_role", id: safeId(binding.roleId, "Role") });
    if (!role?.body.revisions.some((item) => item.revision === binding.roleRevision)) throw new GovernanceError("NOT_FOUND", "The exact Custom Role revision is unavailable.");
  }

  private validateApprovalPolicy(policy: Omit<ApprovalPolicyRevision, "schema" | "revision" | "createdByUserId" | "createdAt">) {
    if (policy.deadlineSeconds < 60 || policy.expiresAfterSeconds < policy.deadlineSeconds || policy.expiresAfterSeconds > 30 * 86_400) throw new GovernanceError("INVALID_INPUT", "Approval deadlines are invalid.");
    const roles = policy.mode.kind === "sequential" ? policy.mode.stages.flatMap((stage) => stage.eligibleRoleIds) : policy.mode.eligibleRoleIds;
    if (!roles.length || unique(roles).some((role) => !ID.test(role))) throw new GovernanceError("INVALID_INPUT", "Approval eligibility is invalid.");
    if (policy.mode.kind === "quorum" && (policy.mode.required < 1 || policy.mode.required > unique(roles).length)) throw new GovernanceError("INVALID_INPUT", "Approval quorum is invalid.");
    if (policy.mode.kind === "sequential" && policy.mode.stages.some((stage) => !stage.eligibleRoleIds.length)) throw new GovernanceError("INVALID_INPUT", "Approval stages cannot be empty.");
  }

  private validateRetention(rules: RetentionRule[]) {
    if (rules.length !== RETENTION_CLASSES.length || unique(rules.map((rule) => rule.retentionClass)).length !== RETENTION_CLASSES.length) throw new GovernanceError("INVALID_INPUT", "Every Retention Class requires exactly one rule.");
    for (const rule of rules) {
      if (!RETENTION_CLASSES.includes(rule.retentionClass) || !Number.isInteger(rule.durationDays) || rule.durationDays < rule.legalFloorDays || rule.recoverableDays < 0 || rule.recoverableDays > rule.durationDays) throw new GovernanceError("INVALID_INPUT", "Retention rule violates its legal floor or bounds.");
    }
  }

  private async exportJobBody(actor: GovernanceActor, kind: "audit" | "workspace", from: string | null, to: string | null, now: Date, scope: Record<string, unknown>) {
    if (from) exactDate(from, "Export start");
    if (to) exactDate(to, "Export end");
    const authoritySnapshot = { schema: "governance-export-authority-snapshot/v1", requestedByUserId: actor.userId, capability: kind === "audit" ? "audit.export@1" : "exports.manage@1", actorCapabilities: await this.capabilities(actor), scope, capturedAt: now.toISOString() };
    return { schema: "governance-export-job/v1", kind, from, to, requestedByUserId: actor.userId, authoritySnapshot, authoritySnapshotDigest: canonicalDigest(authoritySnapshot), encrypted: true, signedManifestRequired: true, status: "queued", expiresAt: new Date(now.getTime() + 24 * 60 * 60_000).toISOString(), artifactRef: null, manifest: null, lease: null };
  }
}

export const GOVERNANCE_COMMAND_CAPABILITIES = CAPABILITY_BY_COMMAND;
