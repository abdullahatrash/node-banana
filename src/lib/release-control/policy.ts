import { z } from "zod";
import type {
  AccessibilityCriterion,
  ContractMigrationEvidence,
  EvidenceEnvelope,
  ReleaseBlocker,
  ReleaseEvidence,
  ReleaseReadinessDecision,
  ReleaseReadinessInput,
  SupportedLocale,
} from "./types";

const REQUIRED_ACCESSIBILITY: readonly AccessibilityCriterion[] = [
  "keyboard",
  "focus_visible",
  "focus_order",
  "contrast",
  "accessible_name",
  "error_identification",
  "language_metadata",
  "rtl_layout",
  "reflow",
  "target_size",
  "reduced_motion",
  "focus_restoration",
  "live_updates",
  "captions_transcripts",
  "arabic_screen_reader",
  "landmarks",
  "ai_alt_text_labeled_editable",
];
const REQUIRED_PARITY_EVIDENCE = ["sanitized_reference", "tasmeemai_reference_comparison", "adaptation_rationale"] as const;

const EXPECTED_DIRECTION: Record<SupportedLocale, "rtl" | "ltr"> = {
  ar: "rtl",
  en: "ltr",
};

function key(parts: string[]): string {
  return parts.join("\u0000");
}

function liveForBuild(evidence: EvidenceEnvelope, input: ReleaseReadinessInput): boolean {
  return evidence.buildId === input.buildId && evidence.collectedAt <= input.evaluatedAt && evidence.expiresAt > input.evaluatedAt;
}

function pushEvidenceOutcome(blockers: ReleaseBlocker[], evidence: ReleaseEvidence): void {
  if (evidence.outcome === "failed") {
    blockers.push({ code: "EVIDENCE_FAILED", subject: evidence.id, detail: "Required release evidence failed." });
  } else if (evidence.outcome !== "passed") {
    blockers.push({ code: "EVIDENCE_UNRESOLVED", subject: evidence.id, detail: `Required release evidence is ${evidence.outcome}.` });
  }
}

export function evaluateReleaseReadiness(input: ReleaseReadinessInput): ReleaseReadinessDecision {
  const blockers: ReleaseBlocker[] = [];
  const liveEvidence = new Map<string, ReleaseEvidence>();

  if (!input.requiredRoutes.length || !input.supportedClients.length || !input.performanceRequirements.length || !input.requiredDataClasses.length || !input.requiredContracts.length || !input.requiredParityCells.length) blockers.push({ code: "RELEASE_MANIFEST_INVALID", subject: input.buildId, detail: "The server-owned release inventory must be non-empty." });

  for (const item of input.evidence) {
    if (item.buildId !== input.buildId || item.collectedAt > input.evaluatedAt || item.expiresAt <= input.evaluatedAt) {
      blockers.push({ code: "EVIDENCE_STALE", subject: item.id, detail: "Evidence is not current for the evaluated build." });
      continue;
    }
    if (EXPECTED_DIRECTION[item.locale] !== item.direction) {
      blockers.push({ code: "LOCALE_DIRECTION_MISMATCH", subject: item.id, detail: "Locale and rendered direction do not match." });
    }
    liveEvidence.set(item.id, item);
    pushEvidenceOutcome(blockers, item);
  }

  for (const requirement of input.performanceRequirements) {
    const matches = input.evidence.filter((item) => item.kind === "performance" && item.route === requirement.route && item.client === requirement.clientId && item.locale === requirement.locale && item.metric === requirement.metric && item.cacheState === requirement.cacheState && item.userRegion === requirement.userRegion && item.providerRegion === requirement.providerRegion && item.criticalAction === requirement.criticalAction && item.jobStage === requirement.jobStage && liveForBuild(item, input));
    if (!matches.length) blockers.push({ code: "EVIDENCE_MISSING", subject: `performance:${requirement.id}`, detail: "Current performance evidence is missing for an exact server-owned budget dimension." });
    else if (!matches.some((item) => item.kind === "performance" && item.outcome === "passed" && item.measured <= requirement.budget)) blockers.push({ code: "PERFORMANCE_BUDGET_EXCEEDED", subject: requirement.id, detail: `${requirement.metric} has no passing observation within the ${requirement.budget} budget.` });
  }
  for (const item of input.evidence.filter((candidate) => candidate.kind === "performance")) {
    const declared = input.performanceRequirements.some((requirement) => item.route === requirement.route && item.client === requirement.clientId && item.locale === requirement.locale && item.metric === requirement.metric && item.cacheState === requirement.cacheState && item.userRegion === requirement.userRegion && item.providerRegion === requirement.providerRegion && item.criticalAction === requirement.criticalAction && item.jobStage === requirement.jobStage);
    if (!declared) blockers.push({ code: "PERFORMANCE_DIMENSION_MISMATCH", subject: item.id, detail: "Performance evidence does not map to a signed route/client/cache/region/action/stage budget." });
  }
  for (const route of input.requiredRoutes) {
    for (const client of input.supportedClients) {
      for (const locale of ["ar", "en"] as const) {
        for (const inputMode of client.inputModes) {
          for (const criterion of REQUIRED_ACCESSIBILITY) {
            const accessibility = input.evidence.some((item) => item.kind === "accessibility" && item.route === route && item.client === client.id && item.locale === locale && item.criterion === criterion && item.viewportWidth >= client.minViewportWidth && item.inputMode === inputMode && liveForBuild(item, input));
            if (!accessibility) {
              blockers.push({ code: "EVIDENCE_MISSING", subject: key(["accessibility", route, client.id, locale, inputMode, criterion]), detail: "Current WCAG 2.2 AA evidence is missing for the required viewport and input mode." });
            }
          }
        }
      }
    }
  }

  for (const flag of input.flags) {
    if (flag.status !== "active") continue;
    if (flag.buildId !== input.buildId) blockers.push({ code: "FLAG_EVIDENCE_MISSING", subject: flag.id, detail: "Active release flag is not bound to the current build." });
    if (flag.expiresAt <= input.evaluatedAt) blockers.push({ code: "FLAG_EXPIRED", subject: flag.id, detail: "Active release flag has expired." });
    if (flag.safeDefault !== "off" || flag.rolloutPercent < 0 || flag.rolloutPercent > 100) blockers.push({ code: "FLAG_UNSAFE_DEFAULT", subject: flag.id, detail: "Release flag must fail closed with a valid rollout." });
    if (flag.evidenceIds.length === 0 || flag.evidenceIds.some((id) => !liveEvidence.has(id))) blockers.push({ code: "FLAG_EVIDENCE_MISSING", subject: flag.id, detail: "Active release flag lacks current evidence." });
    if (!flag.eligibility.roles.length || !flag.eligibility.entitlements.length || !flag.eligibility.locales.length || flag.telemetryEventName !== "release_flag_evaluated" || !flag.rollback.ownerUserId) blockers.push({ code: "FLAG_UNSAFE_DEFAULT", subject: flag.id, detail: "Release flag eligibility, evaluation telemetry, and rollback controls are mandatory." });
    if (flag.dependencyFlagIds.some((id) => !input.flags.some((dependency) => dependency.id === id && dependency.status === "active" && dependency.buildId === input.buildId && dependency.expiresAt > input.evaluatedAt))) blockers.push({ code: "FLAG_DEPENDENCY_INVALID", subject: flag.id, detail: "A release-flag dependency is missing, retired, stale, or belongs to another build." });
    const visit = (id: string, path: Set<string>): boolean => { if (path.has(id)) return true; const next = input.flags.find((item) => item.id === id); if (!next) return false; const extended = new Set(path).add(id); return next.dependencyFlagIds.some((dependency) => visit(dependency, extended)); };
    if (visit(flag.id, new Set())) blockers.push({ code: "FLAG_DEPENDENCY_INVALID", subject: flag.id, detail: "Release-flag dependencies contain a cycle." });
  }

  for (const incident of input.incidents) {
    if (incident.status !== "resolved") blockers.push({ code: "INCIDENT_ACTIVE", subject: incident.id, detail: `A ${incident.severity} service incident is ${incident.status}.` });
  }

  for (const objective of input.recoveryObjectives) {
    if (!Number.isSafeInteger(objective.rpoSeconds) || objective.rpoSeconds < 0 || !Number.isSafeInteger(objective.rtoSeconds) || objective.rtoSeconds <= 0 || objective.backupRegions.length < 2 || !objective.pitrWindowSeconds || !objective.backupRetentionDays || !objective.backupDeletionSlaDays || objective.backupDeletionSlaDays > objective.backupRetentionDays || !objective.immutableArtifactRecovery || !objective.artifactReconciliation || !objective.externalEffectReconciliation) {
      blockers.push({ code: "RECOVERY_OBJECTIVE_INVALID", subject: objective.dataClass, detail: "RPO and RTO must be explicit valid durations." });
      continue;
    }
    const drills = input.restoreDrills.filter((drill) => drill.dataClass === objective.dataClass && drill.buildId === input.buildId && drill.expiresAt > input.evaluatedAt && drill.completedAt <= input.evaluatedAt);
    if (drills.length === 0) {
      blockers.push({ code: "RESTORE_DRILL_MISSING", subject: objective.dataClass, detail: "A current restore drill is required." });
    } else if (!drills.some((drill) => drill.outcome === "passed" && objective.backupRegions.includes(drill.backupRegion) && drill.pitrVerified && drill.immutableArtifactRecoveryVerified && drill.artifactReconciliationVerified && drill.externalEffectReconciliationVerified && drill.observedDataLossSeconds <= objective.rpoSeconds && drill.observedRecoverySeconds <= objective.rtoSeconds)) {
      blockers.push({ code: "RESTORE_DRILL_FAILED", subject: objective.dataClass, detail: "No current restore drill meets the recovery objective." });
    }
  }
  for (const dataClass of input.requiredDataClasses) if (!input.recoveryObjectives.some((item) => item.dataClass === dataClass)) blockers.push({ code: "RELEASE_INVENTORY_MISSING", subject: `recovery:${dataClass}`, detail: "The manifest requires a recovery objective and passing restore evidence." });

  for (const migration of input.contractMigrations) {
    const safe = migration.buildId === input.buildId && migration.expiresAt > input.evaluatedAt && migration.status === "verified" && migration.compatibilityVerified && migration.rollbackVerified && migration.resumable && Boolean(migration.cursorSchemaVersion) && migration.compatibilityWindowStartsAt <= input.evaluatedAt && migration.compatibilityWindowEndsAt > input.evaluatedAt && migration.dryRunVerified && migration.progressPercent === 100 && migration.failureCount === 0 && /^sha256:[a-f0-9]{64}$/.test(migration.pinnedDefinitionDigest);
    if (!safe) blockers.push({ code: "CONTRACT_MIGRATION_UNSAFE", subject: migration.id, detail: `${migration.contract} ${migration.phase} is not verified and reversible for this build.` });
  }
  for (const contract of input.requiredContracts) {
    const phases = new Set(input.contractMigrations.filter((item) => item.contract === contract).map((item) => item.phase));
    if (!["expand", "migrate", "contract"].every((phase) => phases.has(phase as ContractMigrationEvidence["phase"]))) blockers.push({ code: "RELEASE_INVENTORY_MISSING", subject: `contract:${contract}`, detail: "The manifest requires verified expand, migrate, and contract evidence." });
  }

  let passingCells = 0;
  for (const cell of input.requiredParityCells) {
    const requirement = input.parity.find((item) => item.id === cell.id);
    if (!requirement) { blockers.push({ code: "PARITY_CELL_MISSING", subject: cell.id, detail: "A signed manifest parity cell has no evidence record." }); continue; }
    const dimensionsMatch = requirement.route === cell.route && requirement.feature === cell.feature && requirement.state === cell.state && requirement.role === cell.role && requirement.entitlement === cell.entitlement && requirement.viewport === cell.viewport && requirement.direction === cell.direction;
    if (!dimensionsMatch) blockers.push({ code: "PARITY_DIMENSION_MISMATCH", subject: cell.id, detail: "Parity evidence does not match the exact signed route/feature/state/role/entitlement/viewport/direction cell." });
    const parityEvidence = requirement.evidenceIds.map((id) => liveEvidence.get(id));
    const evidenceReady = requirement.evidenceIds.length === REQUIRED_PARITY_EVIDENCE.length && REQUIRED_PARITY_EVIDENCE.every((evidenceClass) => parityEvidence.some((item) => item?.kind === "parity" && item.evidenceClass === evidenceClass && item.outcome === "passed" && item.sanitized && item.route === cell.route && item.feature === cell.feature && item.state === cell.state && item.role === cell.role && item.entitlement === cell.entitlement && item.viewport === cell.viewport && item.direction === cell.direction));
    const current = requirement.buildId === input.buildId && requirement.evaluatedAt <= input.evaluatedAt && requirement.expiresAt > input.evaluatedAt;
    const signoffs = [requirement.productSignoffUserId, requirement.engineeringSignoffUserId, requirement.arabicLocalizationSignoffUserId, requirement.accessibilitySignoffUserId, requirement.securitySignoffUserId];
    const signoffsReady = signoffs.every(Boolean) && new Set(signoffs).size === 5;
    if (!signoffsReady) blockers.push({ code: "PARITY_SIGNOFF_INVALID", subject: cell.id, detail: "Parity requires distinct product, engineering, Arabic/localization, accessibility, and security sign-offs." });
    if (!current || requirement.status !== "passed" || !evidenceReady) blockers.push({ code: "PARITY_UNVERIFIED", subject: cell.id, detail: "Unknown, stale, skipped, failing, or unevidenced parity cells block the claim." });
    if (dimensionsMatch && signoffsReady && current && requirement.status === "passed" && evidenceReady) passingCells += 1;
  }
  for (const requirement of input.parity) if (!input.requiredParityCells.some((cell) => cell.id === requirement.id)) blockers.push({ code: "PARITY_DIMENSION_MISMATCH", subject: requirement.id, detail: "Parity evidence references a cell absent from the signed manifest." });

  return {
    schema: "release-readiness-decision/v1",
    buildId: input.buildId,
    evaluatedAt: input.evaluatedAt,
    releasable: blockers.length === 0,
    parityClaimAllowed: blockers.length === 0 && passingCells === input.requiredParityCells.length,
    parityMatrix: { requiredCells: input.requiredParityCells.length, passingCells },
    blockers,
  };
}

const commonTelemetry = {
  schema: z.literal("product-telemetry-event/v1"),
  eventId: z.string().regex(/^pte_[a-zA-Z0-9_-]{8,80}$/),
  workspacePseudonym: z.string().regex(/^wsp_[a-f0-9]{32,64}$/),
  sessionPseudonym: z.string().regex(/^ses_[a-f0-9]{32,64}$/),
  occurredAt: z.coerce.date(),
  locale: z.enum(["ar", "en"]),
  direction: z.enum(["rtl", "ltr"]),
  consentRevision: z.string().regex(/^consent_[a-zA-Z0-9_-]{4,80}$/),
  consentPurpose: z.literal("product_analytics"),
  regionClassification: z.enum(["mena", "non_mena", "unknown"]),
  buildId: z.string().min(1).max(120),
};

export const ProductTelemetryEventSchema = z.discriminatedUnion("name", [
  z.object({ ...commonTelemetry, name: z.literal("surface_viewed"), properties: z.object({ surface: z.enum(["dashboard", "copy", "images", "videos", "operations", "settings"]), referrerKind: z.enum(["direct", "internal", "campaign"]) }).strict() }).strict(),
  z.object({ ...commonTelemetry, name: z.literal("generation_requested"), properties: z.object({ mediaKind: z.enum(["copy", "image", "video"]), aspectRatio: z.enum(["1:1", "4:5", "9:16", "16:9"]), providerFamily: z.enum(["google", "openai", "replicate", "kie", "fal", "wavespeed"]), brandProfileAttached: z.boolean() }).strict() }).strict(),
  z.object({ ...commonTelemetry, name: z.literal("operation_terminal"), properties: z.object({ operationKind: z.enum(["generation", "publishing", "export", "import", "automation", "brand_ingestion"]), outcome: z.enum(["succeeded", "failed_known", "cancelled", "outcome_unknown"]), durationBucket: z.enum(["lt_1s", "1s_10s", "10s_60s", "1m_5m", "gte_5m"]) }).strict() }).strict(),
  z.object({ ...commonTelemetry, name: z.literal("release_flag_evaluated"), properties: z.object({ flagId: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$/), eligible: z.boolean(), enabled: z.boolean(), rolloutRevision: z.number().int().positive() }).strict() }).strict(),
  z.object({ ...commonTelemetry, name: z.literal("experiment_exposed"), properties: z.object({ experimentId: z.string().regex(/^exp_[a-zA-Z0-9_-]{4,80}$/), variant: z.string().regex(/^[a-zA-Z0-9_-]{1,40}$/), assignmentRevision: z.number().int().positive() }).strict() }).strict(),
  z.object({ ...commonTelemetry, name: z.literal("experiment_outcome"), properties: z.object({ experimentId: z.string().regex(/^exp_[a-zA-Z0-9_-]{4,80}$/), assignmentRevision: z.number().int().positive(), exposureEventId: z.string().regex(/^pte_[a-zA-Z0-9_-]{8,80}$/), metric: z.enum(["activation", "completion", "retention", "conversion"]), value: z.number().finite().min(0).max(1), guardrailValues: z.array(z.object({ metric: z.enum(["error_rate", "latency", "credit_error", "publish_failure"]), value: z.number().finite().nonnegative() }).strict()).max(10) }).strict() }).strict(),
]);

export type ProductTelemetryEvent = z.infer<typeof ProductTelemetryEventSchema>;

export function parseProductTelemetryEvent(value: unknown): ProductTelemetryEvent {
  const parsed = ProductTelemetryEventSchema.safeParse(value);
  if (!parsed.success) throw new TypeError("Product telemetry violates the privacy-safe allowlist.");
  if (EXPECTED_DIRECTION[parsed.data.locale] !== parsed.data.direction) throw new TypeError("Product telemetry locale direction is invalid.");
  return parsed.data;
}
