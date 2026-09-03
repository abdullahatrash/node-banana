import { z } from "zod";

const id = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$/);
const iso = z.string().datetime({ offset: true });
const locale = z.enum(["ar", "en"]);
const direction = z.enum(["rtl", "ltr"]);
const outcome = z.enum(["passed", "failed", "unknown", "skipped"]);
const commonEvidence = { id, buildId: z.string().min(1).max(120), collectedAt: iso, expiresAt: iso, outcome, locale, direction, client: z.string().min(1).max(120), route: z.string().startsWith("/").max(240) };

export const performanceEvidenceSchema = z.object({
  ...commonEvidence,
  kind: z.literal("performance"),
  metric: z.enum(["largest_contentful_paint_ms", "interaction_to_next_paint_ms", "cumulative_layout_shift_milli", "api_p95_ms", "job_stage_p95_ms"]),
  measured: z.number().finite().nonnegative(),
  budget: z.number().finite().positive(),
  sampleCount: z.number().int().positive(),
  runner: z.string().min(1).max(120),
  artifactDigest: z.string().regex(/^sha256:[a-f0-9]{64}$/),
}).strict();

export const accessibilityEvidenceSchema = z.object({
  ...commonEvidence,
  kind: z.literal("accessibility"),
  criterion: z.enum(["keyboard", "focus_visible", "focus_order", "contrast", "accessible_name", "error_identification", "language_metadata", "rtl_layout", "reflow", "target_size", "reduced_motion"]),
  standard: z.literal("WCAG_2_2_AA"),
  runner: z.string().min(1).max(120),
  artifactDigest: z.string().regex(/^sha256:[a-f0-9]{64}$/),
}).strict();

export const releaseEvidenceSchema = z.discriminatedUnion("kind", [performanceEvidenceSchema, accessibilityEvidenceSchema]);
export const releaseFlagSchema = z.object({ id, ownerUserId: id, hypothesis: z.string().min(8).max(500), createdAt: iso, expiresAt: iso, rolloutPercent: z.number().int().min(0).max(100), safeDefault: z.literal("off"), status: z.enum(["active", "retired"]), evidenceIds: z.array(id).min(1).max(100) }).strict();
export const incidentSchema = z.object({ id, severity: z.enum(["minor", "major", "critical"]), status: z.enum(["investigating", "identified", "monitoring", "resolved"]), impactedServices: z.array(z.string().min(1).max(100)).min(1).max(30), startedAt: iso, resolvedAt: iso.nullable(), publicSummary: z.object({ ar: z.string().min(1).max(2000), en: z.string().min(1).max(2000) }).strict() }).strict();
export const recoveryObjectiveSchema = z.object({ id, dataClass: z.string().min(1).max(100), rpoSeconds: z.number().int().nonnegative(), rtoSeconds: z.number().int().positive(), ownerUserId: id, approvedAt: iso, artifactDigest: z.string().regex(/^sha256:[a-f0-9]{64}$/) }).strict();
export const restoreDrillSchema = z.object({ id, dataClass: z.string().min(1).max(100), buildId: z.string().min(1).max(120), startedAt: iso, completedAt: iso, observedDataLossSeconds: z.number().int().nonnegative(), observedRecoverySeconds: z.number().int().nonnegative(), outcome, expiresAt: iso, artifactDigest: z.string().regex(/^sha256:[a-f0-9]{64}$/), executedByUserId: id }).strict();
export const contractMigrationSchema = z.object({ id, contract: z.string().min(1).max(160), buildId: z.string().min(1).max(120), phase: z.enum(["expand", "migrate", "contract"]), status: z.enum(["planned", "running", "verified", "failed", "rolled_back"]), compatibilityVerified: z.boolean(), rollbackVerified: z.boolean(), observedAt: iso, expiresAt: iso, artifactDigest: z.string().regex(/^sha256:[a-f0-9]{64}$/), predecessorId: id.nullable() }).strict();
export const parityRequirementSchema = z.object({ id, feature: z.string().min(1).max(240), buildId: z.string().min(1).max(120), requiredLocales: z.array(locale).min(2).max(2), evidenceIds: z.array(id).min(1).max(100), productSignoffUserId: id.nullable(), engineeringSignoffUserId: id.nullable(), status: outcome, evaluatedAt: iso, expiresAt: iso, artifactDigest: z.string().regex(/^sha256:[a-f0-9]{64}$/) }).strict().superRefine((value, ctx) => { if (new Set(value.requiredLocales).size !== 2) ctx.addIssue({ code: "custom", path: ["requiredLocales"], message: "Arabic and English are both required." }); if (value.productSignoffUserId && value.productSignoffUserId === value.engineeringSignoffUserId) ctx.addIssue({ code: "custom", path: ["engineeringSignoffUserId"], message: "Independent sign-off is required." }); });
export const experimentSchema = z.object({ id: z.string().regex(/^exp_[A-Za-z0-9_-]{4,80}$/), buildId: z.string().min(1).max(120), hypothesis: z.string().min(8).max(500), variants: z.array(z.string().regex(/^[A-Za-z0-9_-]{1,40}$/)).min(2).max(10), allocationPercent: z.number().int().min(0).max(100), status: z.enum(["draft", "active", "paused", "completed"]), startsAt: iso, expiresAt: iso, ownerUserId: id, metric: z.enum(["activation", "completion", "retention", "conversion"]), evidenceIds: z.array(id).max(100) }).strict();

export const releaseRecordInputSchema = z.discriminatedUnion("recordKind", [
  z.object({ recordKind: z.literal("evidence"), document: releaseEvidenceSchema }).strict(),
  z.object({ recordKind: z.literal("flag"), document: releaseFlagSchema }).strict(),
  z.object({ recordKind: z.literal("incident"), document: incidentSchema }).strict(),
  z.object({ recordKind: z.literal("recovery_objective"), document: recoveryObjectiveSchema }).strict(),
  z.object({ recordKind: z.literal("restore_drill"), document: restoreDrillSchema }).strict(),
  z.object({ recordKind: z.literal("contract_migration"), document: contractMigrationSchema }).strict(),
  z.object({ recordKind: z.literal("parity_requirement"), document: parityRequirementSchema }).strict(),
  z.object({ recordKind: z.literal("experiment"), document: experimentSchema }).strict(),
]);

export type ReleaseRecordInput = z.infer<typeof releaseRecordInputSchema>;
