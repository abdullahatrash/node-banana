import { z } from "zod";

const id = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$/);
const iso = z.string().datetime({ offset: true });
const locale = z.enum(["ar", "en"]);
const direction = z.enum(["rtl", "ltr"]);
const outcome = z.enum(["passed", "failed", "unknown", "skipped"]);
const dimension = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$/);
const commonEvidence = { id, buildId: z.string().min(1).max(120), collectedAt: iso, expiresAt: iso, outcome, locale, direction, client: z.string().min(1).max(120), route: z.string().startsWith("/").max(240) };

export const performanceEvidenceSchema = z.object({
  ...commonEvidence,
  kind: z.literal("performance"),
  metric: z.enum(["largest_contentful_paint_ms", "interaction_to_next_paint_ms", "cumulative_layout_shift_milli", "critical_action_p95_ms", "api_p95_ms", "job_stage_p95_ms"]),
  measured: z.number().finite().nonnegative(),
  cacheState: z.enum(["cold", "warm"]),
  userRegion: z.literal("mena"),
  providerRegion: dimension,
  criticalAction: dimension.nullable(),
  jobStage: dimension.nullable(),
  sampleCount: z.number().int().positive(),
  runner: z.string().min(1).max(120),
  artifactDigest: z.string().regex(/^sha256:[a-f0-9]{64}$/),
}).strict();

export const accessibilityEvidenceSchema = z.object({
  ...commonEvidence,
  kind: z.literal("accessibility"),
  criterion: z.enum(["keyboard", "focus_visible", "focus_order", "contrast", "accessible_name", "error_identification", "language_metadata", "rtl_layout", "reflow", "target_size", "reduced_motion", "focus_restoration", "live_updates", "captions_transcripts", "arabic_screen_reader", "landmarks", "ai_alt_text_labeled_editable"]),
  standard: z.literal("WCAG_2_2_AA"),
  viewportWidth: z.number().int().min(390).max(10_000),
  inputMode: z.enum(["keyboard", "touch", "mouse", "screen_reader"]),
  runner: z.string().min(1).max(120),
  artifactDigest: z.string().regex(/^sha256:[a-f0-9]{64}$/),
}).strict();

export const parityCellEvidenceSchema = z.object({
  ...commonEvidence,
  kind: z.literal("parity"),
  feature: dimension,
  state: dimension,
  role: dimension,
  entitlement: dimension,
  viewport: z.enum(["mobile", "tablet", "desktop"]),
  evidenceClass: z.enum(["sanitized_reference", "tasmeemai_reference_comparison", "adaptation_rationale"]),
  sanitized: z.literal(true),
  runner: z.string().min(1).max(120),
  artifactDigest: z.string().regex(/^sha256:[a-f0-9]{64}$/),
}).strict();

export const releaseEvidenceSchema = z.discriminatedUnion("kind", [performanceEvidenceSchema, accessibilityEvidenceSchema, parityCellEvidenceSchema]);
export const releaseFlagSchema = z.object({ id, buildId: z.string().min(1).max(120), ownerUserId: id, hypothesis: z.string().min(8).max(500), createdAt: iso, expiresAt: iso, rolloutPercent: z.number().int().min(0).max(100), safeDefault: z.literal("off"), status: z.enum(["active", "retired"]), evidenceIds: z.array(id).min(1).max(100), eligibility: z.object({ roles: z.array(dimension).min(1).max(20), entitlements: z.array(dimension).min(1).max(20), locales: z.array(locale).min(1).max(2) }).strict(), dependencyFlagIds: z.array(id).max(30), telemetryEventName: z.literal("release_flag_evaluated"), rollback: z.object({ mode: z.enum(["automatic", "manual"]), triggerMetric: z.enum(["error_rate", "latency", "completion", "conversion"]), threshold: z.number().finite().positive(), windowMinutes: z.number().int().min(1).max(10080), ownerUserId: id }).strict() }).strict().superRefine((value, ctx) => { if (value.dependencyFlagIds.includes(value.id)) ctx.addIssue({ code: "custom", path: ["dependencyFlagIds"], message: "A flag cannot depend on itself." }); for (const key of ["roles", "entitlements", "locales"] as const) if (new Set(value.eligibility[key]).size !== value.eligibility[key].length) ctx.addIssue({ code: "custom", path: ["eligibility", key], message: "Eligibility values must be unique." }); });
export const incidentSchema = z.object({ id, severity: z.enum(["minor", "major", "critical"]), status: z.enum(["investigating", "identified", "monitoring", "resolved"]), impactedServices: z.array(z.string().min(1).max(100)).min(1).max(30), startedAt: iso, resolvedAt: iso.nullable(), publicSummary: z.object({ ar: z.string().min(1).max(2000), en: z.string().min(1).max(2000) }).strict(), operationOutcome: z.enum(["none", "waiting", "blocked", "failed_known", "outcome_unknown"]), creditRisk: z.enum(["none", "at_risk", "incorrect_charge"]), publishingRisk: z.enum(["none", "delay", "duplicate", "outcome_unknown"]) }).strict();
export const recoveryObjectiveSchema = z.object({ id, dataClass: z.string().min(1).max(100), rpoSeconds: z.number().int().nonnegative(), rtoSeconds: z.number().int().positive(), ownerUserId: id, approvedAt: iso, artifactDigest: z.string().regex(/^sha256:[a-f0-9]{64}$/), backupEncryption: z.enum(["AES_256_GCM", "KMS_ENVELOPE"]), backupRegions: z.array(dimension).min(2).max(10), pitrWindowSeconds: z.number().int().positive(), backupRetentionDays: z.number().int().positive().max(3650), backupDeletionSlaDays: z.number().int().positive().max(365), immutableArtifactRecovery: z.literal(true), artifactReconciliation: z.literal(true), externalEffectReconciliation: z.literal(true) }).strict().superRefine((value, ctx) => { if (new Set(value.backupRegions).size !== value.backupRegions.length) ctx.addIssue({ code: "custom", path: ["backupRegions"], message: "Backup regions must be distinct." }); if (value.backupDeletionSlaDays > value.backupRetentionDays) ctx.addIssue({ code: "custom", path: ["backupDeletionSlaDays"], message: "Backup deletion SLA must not exceed retention." }); });
export const restoreDrillSchema = z.object({ id, dataClass: z.string().min(1).max(100), buildId: z.string().min(1).max(120), startedAt: iso, completedAt: iso, observedDataLossSeconds: z.number().int().nonnegative(), observedRecoverySeconds: z.number().int().nonnegative(), outcome, expiresAt: iso, artifactDigest: z.string().regex(/^sha256:[a-f0-9]{64}$/), executedByUserId: id, backupRegion: dimension, pitrVerified: z.boolean(), immutableArtifactRecoveryVerified: z.boolean(), artifactReconciliationVerified: z.boolean(), externalEffectReconciliationVerified: z.boolean() }).strict();
export const contractMigrationSchema = z.object({ id, contract: z.string().min(1).max(160), buildId: z.string().min(1).max(120), phase: z.enum(["expand", "migrate", "contract"]), status: z.enum(["planned", "running", "verified", "failed", "rolled_back"]), compatibilityVerified: z.boolean(), rollbackVerified: z.boolean(), observedAt: iso, expiresAt: iso, artifactDigest: z.string().regex(/^sha256:[a-f0-9]{64}$/), predecessorId: id.nullable(), resumable: z.literal(true), cursorSchemaVersion: dimension, resumeCursorEvidenceDigest: z.string().regex(/^sha256:[a-f0-9]{64}$/), compatibilityWindowStartsAt: iso, compatibilityWindowEndsAt: iso, dryRunVerified: z.boolean(), progressPercent: z.number().int().min(0).max(100), failureCount: z.number().int().nonnegative(), pinnedDefinitionDigest: z.string().regex(/^sha256:[a-f0-9]{64}$/) }).strict();
export const parityRequirementSchema = z.object({ id, route: z.string().startsWith("/").max(240), feature: dimension, state: dimension, role: dimension, entitlement: dimension, viewport: z.enum(["mobile", "tablet", "desktop"]), direction, buildId: z.string().min(1).max(120), evidenceIds: z.array(id).length(3), productSignoffUserId: id.nullable(), engineeringSignoffUserId: id.nullable(), arabicLocalizationSignoffUserId: id.nullable(), accessibilitySignoffUserId: id.nullable(), securitySignoffUserId: id.nullable(), status: outcome, evaluatedAt: iso, expiresAt: iso, artifactDigest: z.string().regex(/^sha256:[a-f0-9]{64}$/) }).strict().superRefine((value, ctx) => { const signoffs = [value.productSignoffUserId, value.engineeringSignoffUserId, value.arabicLocalizationSignoffUserId, value.accessibilitySignoffUserId, value.securitySignoffUserId].filter((item): item is string => Boolean(item)); if (new Set(signoffs).size !== signoffs.length) ctx.addIssue({ code: "custom", path: ["productSignoffUserId"], message: "Every parity sign-off must be independent." }); if (new Set(value.evidenceIds).size !== value.evidenceIds.length) ctx.addIssue({ code: "custom", path: ["evidenceIds"], message: "Parity evidence IDs must be unique." }); });
export const experimentSchema = z.object({ id: z.string().regex(/^exp_[A-Za-z0-9_-]{4,80}$/), buildId: z.string().min(1).max(120), hypothesis: z.string().min(8).max(500), variants: z.array(z.string().regex(/^[A-Za-z0-9_-]{1,40}$/)).min(2).max(10), allocationPercent: z.number().int().min(0).max(100), status: z.enum(["draft", "active", "paused", "completed"]), startsAt: iso, expiresAt: iso, ownerUserId: id, metric: z.enum(["activation", "completion", "retention", "conversion"]), guardrails: z.array(z.object({ metric: z.enum(["error_rate", "latency", "credit_error", "publish_failure"]), direction: z.enum(["below", "above"]), threshold: z.number().finite().nonnegative() }).strict()).min(1).max(10), evidenceIds: z.array(id).max(100) }).strict().superRefine((value, ctx) => { if (!value.variants.includes("control") || new Set(value.variants).size !== value.variants.length) ctx.addIssue({ code: "custom", path: ["variants"], message: "Experiments require one unique control variant." }); if (new Set(value.guardrails.map((item) => item.metric)).size !== value.guardrails.length) ctx.addIssue({ code: "custom", path: ["guardrails"], message: "Experiment guardrail metrics must be unique." }); });

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
