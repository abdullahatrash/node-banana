import { z } from "zod";
import type { GovernanceCommand } from "./service";
import { BUILT_IN_WORKSPACE_ROLES, GOVERNANCE_CAPABILITIES, RETENTION_CLASSES } from "./types";

const id = z.string().trim().min(1).max(200);
const text = z.string().trim().min(1).max(2_000);
const timestamp = z.string().datetime({ offset: true });
const digest = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const applicationCapability = z.object({
  name: z.string().regex(/^[a-z][a-z0-9_.]*$/),
  version: z.number().int().positive(),
}).strict();
const binding = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("built_in"), role: z.enum(BUILT_IN_WORKSPACE_ROLES) }).strict(),
  z.object({ kind: z.literal("custom"), roleId: id, roleRevision: z.number().int().positive() }).strict(),
]);
const approvalMode = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("single"), eligibleRoleIds: z.array(id).min(1) }).strict(),
  z.object({ kind: z.literal("any_of"), eligibleRoleIds: z.array(id).min(1) }).strict(),
  z.object({ kind: z.literal("sequential"), stages: z.array(z.object({ eligibleRoleIds: z.array(id).min(1) }).strict()).min(1) }).strict(),
  z.object({ kind: z.literal("quorum"), eligibleRoleIds: z.array(id).min(1), required: z.number().int().positive() }).strict(),
]);
const policy = z.object({ purpose: z.enum(["content_acceptance", "publishing_approval"]), mode: approvalMode, separationOfDuty: z.boolean(), deadlineSeconds: z.number().int().positive(), escalationRoleIds: z.array(id), expiresAfterSeconds: z.number().int().positive() }).strict();
const regionEvidence = z.object({
  schema: z.literal("governance-region-deployment-evidence/v1"), keyId: id, deploymentId: id,
  region: id, issuedAt: timestamp, expiresAt: timestamp,
  routes: z.array(z.object({ kind: z.enum(["primary_storage", "processing", "backup", "logging", "deletion"]), routeId: id, region: id }).strict()).min(5),
  signature: z.string().regex(/^[A-Za-z0-9_-]{43,128}$/),
}).strict();

export const governanceCommandSchema: z.ZodType<GovernanceCommand> = z.discriminatedUnion("type", [
  z.object({ type: z.literal("create_custom_role"), name: text.max(80), description: text.max(500), capabilities: z.array(z.enum(GOVERNANCE_CAPABILITIES)).min(1), applicationCapabilities: z.array(applicationCapability).max(100).optional() }).strict(),
  z.object({ type: z.literal("revise_custom_role"), roleId: id, expectedVersion: z.number().int().positive(), name: text.max(80), description: text.max(500), capabilities: z.array(z.enum(GOVERNANCE_CAPABILITIES)).min(1), applicationCapabilities: z.array(applicationCapability).max(100).optional() }).strict(),
  z.object({ type: z.literal("assign_role"), userId: id, binding }).strict(),
  z.object({ type: z.literal("create_invitation"), email: z.string().trim().email(), binding, expiresAt: timestamp }).strict(),
  z.object({ type: z.literal("revoke_invitation"), invitationId: id }).strict(),
  z.object({ type: z.literal("remove_member"), userId: id }).strict(),
  z.object({ type: z.literal("transfer_ownership"), newOwnerUserId: id, stepUpToken: id }).strict(),
  z.object({ type: z.literal("request_workspace_closure"), reason: text.max(1_000), coolingOffDays: z.number().int().min(7).max(30), stepUpToken: id }).strict(),
  z.object({ type: z.literal("cancel_workspace_closure"), closureId: id }).strict(),
  z.object({ type: z.literal("execute_workspace_closure"), closureId: id, stepUpToken: id }).strict(),
  z.object({ type: z.literal("create_portfolio"), name: text.max(120) }).strict(),
  z.object({ type: z.literal("assign_portfolio"), portfolioId: id, assigneeUserId: id, targetWorkspaceId: id, permissions: z.array(z.enum(["navigate", "report", "templates", "bulk"])).min(1), capabilityAllowlist: z.array(z.string().regex(/^[a-z][a-z0-9_.]*@[1-9][0-9]*$/)).min(1), resourceAllowlist: z.array(z.object({ kind: id, id }).strict()).min(1), expiresAt: timestamp.nullable() }).strict(),
  z.object({ type: z.literal("revoke_portfolio_assignment"), assignmentId: id }).strict(),
  z.object({ type: z.literal("issue_review_guest"), email: z.string().trim().email(), purpose: z.enum(["inspect", "comment", "accept_content", "approve_publishing", "reject"]), resourceKind: z.enum(["render_proof", "plan_revision"]), resourceId: id, revisionDigest: digest, expiresAt: timestamp }).strict(),
  z.object({ type: z.literal("revoke_review_guest"), grantId: id }).strict(),
  z.object({ type: z.literal("publish_approval_policy"), policyId: id.optional(), expectedVersion: z.number().int().positive().optional(), policy }).strict(),
  z.object({ type: z.literal("request_content_acceptance"), policyId: id, policyRevision: z.number().int().positive(), resourceKind: id, resourceId: id, revisionDigest: digest }).strict(),
  z.object({ type: z.literal("decide_content_acceptance"), requestId: id, decision: z.enum(["approve", "reject"]) }).strict(),
  z.object({ type: z.literal("advance_content_acceptance"), requestId: id }).strict(),
  z.object({ type: z.literal("begin_step_up"), purpose: id, resourceId: id.nullable() }).strict(),
  z.object({ type: z.literal("verify_step_up"), challengeId: id, code: z.string().regex(/^\d{6}$/) }).strict(),
  z.object({ type: z.literal("request_audit_export"), from: timestamp.nullable(), to: timestamp.nullable(), stepUpToken: id }).strict(),
  z.object({ type: z.literal("set_region_policy"), region: id, verificationEvidence: regionEvidence, expectedVersion: z.number().int().positive().optional(), stepUpToken: id }).strict(),
  z.object({ type: z.literal("publish_retention_policy"), rules: z.array(z.object({ retentionClass: z.enum(RETENTION_CLASSES), durationDays: z.number().int().nonnegative(), recoverableDays: z.number().int().nonnegative(), legalFloorDays: z.number().int().nonnegative() }).strict()), expectedVersion: z.number().int().positive().optional(), stepUpToken: id }).strict(),
  z.object({ type: z.literal("create_retention_hold"), retentionClasses: z.array(z.enum(RETENTION_CLASSES)).min(1), reason: text.max(1_000), expiresAt: timestamp.nullable(), stepUpToken: id }).strict(),
  z.object({ type: z.literal("release_retention_hold"), holdId: id, reason: text.max(1_000), stepUpToken: id }).strict(),
  z.object({ type: z.literal("record_deletion"), resourceKind: id, resourceId: id, retentionClass: z.enum(RETENTION_CLASSES), systems: z.array(id).min(1).max(32), stepUpToken: id }).strict(),
  z.object({ type: z.literal("create_safety_decision"), intentRef: id, reasonCode: id, policyVersion: id, safeExplanation: text, evidenceRef: id, remediation: text, appealEligible: z.boolean() }).strict(),
  z.object({ type: z.literal("appeal_safety_decision"), decisionId: id, explanation: text }).strict(),
  z.object({ type: z.literal("resolve_safety_appeal"), appealId: id, outcome: z.enum(["upheld", "reevaluate_exact_intent"]), currentRevalidationRequired: z.literal(true) }).strict(),
  z.object({ type: z.literal("preview_bulk"), operationCapability: id, items: z.array(z.object({ targetWorkspaceId: id, targetKind: id, targetId: id, input: z.record(z.string(), z.unknown()).optional() }).strict()).min(1), concurrency: z.number().int().min(1).max(10), quoteRef: id.nullable() }).strict(),
  z.object({ type: z.literal("start_bulk"), operationId: id, stepUpToken: id.optional() }).strict(),
  z.object({ type: z.literal("cancel_bulk"), operationId: id }).strict(),
  z.object({ type: z.literal("retry_bulk_item"), operationId: id, itemId: id }).strict(),
  z.object({ type: z.literal("preview_import"), source: text.max(300), sourceManifestDigest: digest, manifestKeyId: id, manifestSignature: z.string().regex(/^[A-Za-z0-9_-]{43}$/), items: z.array(z.object({ kind: id, sourceId: id, destinationId: id.optional(), digest, transferable: z.boolean(), omissionReason: text.max(500).optional(), payload: z.record(z.string(), z.unknown()).optional() }).strict()).min(1) }).strict(),
  z.object({ type: z.literal("execute_import"), importId: id }).strict(),
  z.object({ type: z.literal("provide_import_mapping"), importId: id, itemId: id, mapping: z.record(z.string().regex(/^[a-z][A-Za-z0-9]{0,79}$/), z.string().trim().min(1).max(1_024)).refine((value) => Object.keys(value).length > 0 && Object.keys(value).length <= 16) }).strict(),
  z.object({ type: z.literal("request_workspace_export"), includeKinds: z.array(id), stepUpToken: id }).strict(),
]);

export const governanceInvocationSchema = z.object({ command: governanceCommandSchema }).strict();
