import { z } from "zod";
import type {
  AccessibilityCriterion,
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
];
const REQUIRED_WEB_PERFORMANCE = ["largest_contentful_paint_ms", "interaction_to_next_paint_ms", "cumulative_layout_shift_milli"] as const;

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
    if (item.kind === "performance" && item.measured > item.budget) {
      blockers.push({ code: "PERFORMANCE_BUDGET_EXCEEDED", subject: item.id, detail: `${item.metric} measured ${item.measured}; budget is ${item.budget}.` });
    }
  }

  for (const route of input.requiredRoutes) {
    for (const client of input.supportedClients) {
      for (const locale of ["ar", "en"] as const) {
        for (const metric of REQUIRED_WEB_PERFORMANCE) {
          const performance = input.evidence.some((item) => item.kind === "performance" && item.route === route && item.client === client && item.locale === locale && item.metric === metric && liveForBuild(item, input));
          if (!performance) blockers.push({ code: "EVIDENCE_MISSING", subject: key(["performance", route, client, locale, metric]), detail: "Current performance evidence is required for every metric, supported route, client, and locale." });
        }
        for (const criterion of REQUIRED_ACCESSIBILITY) {
          const accessibility = input.evidence.some((item) => item.kind === "accessibility" && item.route === route && item.client === client && item.locale === locale && item.criterion === criterion && liveForBuild(item, input));
          if (!accessibility) {
            blockers.push({ code: "EVIDENCE_MISSING", subject: key(["accessibility", route, client, locale, criterion]), detail: "Current WCAG 2.2 AA evidence is missing." });
          }
        }
      }
    }
  }

  for (const flag of input.flags) {
    if (flag.status !== "active") continue;
    if (flag.expiresAt <= input.evaluatedAt) blockers.push({ code: "FLAG_EXPIRED", subject: flag.id, detail: "Active release flag has expired." });
    if (flag.safeDefault !== "off" || flag.rolloutPercent < 0 || flag.rolloutPercent > 100) blockers.push({ code: "FLAG_UNSAFE_DEFAULT", subject: flag.id, detail: "Release flag must fail closed with a valid rollout." });
    if (flag.evidenceIds.length === 0 || flag.evidenceIds.some((id) => !liveEvidence.has(id))) blockers.push({ code: "FLAG_EVIDENCE_MISSING", subject: flag.id, detail: "Active release flag lacks current evidence." });
  }

  for (const incident of input.incidents) {
    if (incident.status !== "resolved") blockers.push({ code: "INCIDENT_ACTIVE", subject: incident.id, detail: `A ${incident.severity} service incident is ${incident.status}.` });
  }

  for (const objective of input.recoveryObjectives) {
    if (!Number.isSafeInteger(objective.rpoSeconds) || objective.rpoSeconds < 0 || !Number.isSafeInteger(objective.rtoSeconds) || objective.rtoSeconds <= 0) {
      blockers.push({ code: "RECOVERY_OBJECTIVE_INVALID", subject: objective.dataClass, detail: "RPO and RTO must be explicit valid durations." });
      continue;
    }
    const drills = input.restoreDrills.filter((drill) => drill.dataClass === objective.dataClass && drill.buildId === input.buildId && drill.expiresAt > input.evaluatedAt && drill.completedAt <= input.evaluatedAt);
    if (drills.length === 0) {
      blockers.push({ code: "RESTORE_DRILL_MISSING", subject: objective.dataClass, detail: "A current restore drill is required." });
    } else if (!drills.some((drill) => drill.outcome === "passed" && drill.observedDataLossSeconds <= objective.rpoSeconds && drill.observedRecoverySeconds <= objective.rtoSeconds)) {
      blockers.push({ code: "RESTORE_DRILL_FAILED", subject: objective.dataClass, detail: "No current restore drill meets the recovery objective." });
    }
  }

  for (const migration of input.contractMigrations) {
    const safe = migration.buildId === input.buildId && migration.expiresAt > input.evaluatedAt && migration.status === "verified" && migration.compatibilityVerified && migration.rollbackVerified;
    if (!safe) blockers.push({ code: "CONTRACT_MIGRATION_UNSAFE", subject: migration.id, detail: `${migration.contract} ${migration.phase} is not verified and reversible for this build.` });
  }

  for (const requirement of input.parity) {
    const evidenceReady = requirement.evidenceIds.length > 0 && requirement.evidenceIds.every((id) => liveEvidence.get(id)?.outcome === "passed");
    const localesReady = requirement.requiredLocales.includes("ar") && requirement.requiredLocales.includes("en");
    const current = requirement.buildId === input.buildId && requirement.evaluatedAt <= input.evaluatedAt && requirement.expiresAt > input.evaluatedAt;
    if (!current || requirement.status !== "passed" || !evidenceReady || !localesReady || !requirement.productSignoffUserId || !requirement.engineeringSignoffUserId || requirement.productSignoffUserId === requirement.engineeringSignoffUserId) {
      blockers.push({ code: "PARITY_UNVERIFIED", subject: requirement.id, detail: "Parity requires current evidence, Arabic and English coverage, and independent product and engineering sign-off." });
    }
  }

  return {
    schema: "release-readiness-decision/v1",
    buildId: input.buildId,
    evaluatedAt: input.evaluatedAt,
    releasable: blockers.length === 0,
    parityClaimAllowed: blockers.length === 0 && input.parity.length > 0,
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
  buildId: z.string().min(1).max(120),
};

export const ProductTelemetryEventSchema = z.discriminatedUnion("name", [
  z.object({ ...commonTelemetry, name: z.literal("surface_viewed"), properties: z.object({ surface: z.enum(["dashboard", "copy", "images", "videos", "operations", "settings"]), referrerKind: z.enum(["direct", "internal", "campaign"]) }).strict() }).strict(),
  z.object({ ...commonTelemetry, name: z.literal("generation_requested"), properties: z.object({ mediaKind: z.enum(["copy", "image", "video"]), aspectRatio: z.enum(["1:1", "4:5", "9:16", "16:9"]), providerFamily: z.enum(["google", "openai", "replicate", "kie", "fal", "wavespeed"]), brandProfileAttached: z.boolean() }).strict() }).strict(),
  z.object({ ...commonTelemetry, name: z.literal("operation_terminal"), properties: z.object({ operationKind: z.enum(["generation", "publishing", "export", "import", "automation", "brand_ingestion"]), outcome: z.enum(["succeeded", "failed_known", "cancelled", "outcome_unknown"]), durationBucket: z.enum(["lt_1s", "1s_10s", "10s_60s", "1m_5m", "gte_5m"]) }).strict() }).strict(),
  z.object({ ...commonTelemetry, name: z.literal("experiment_exposed"), properties: z.object({ experimentId: z.string().regex(/^exp_[a-zA-Z0-9_-]{4,80}$/), variant: z.string().regex(/^[a-zA-Z0-9_-]{1,40}$/), assignmentRevision: z.number().int().positive() }).strict() }).strict(),
  z.object({ ...commonTelemetry, name: z.literal("experiment_outcome"), properties: z.object({ experimentId: z.string().regex(/^exp_[a-zA-Z0-9_-]{4,80}$/), metric: z.enum(["activation", "completion", "retention", "conversion"]), value: z.number().finite().min(0).max(1) }).strict() }).strict(),
]);

export type ProductTelemetryEvent = z.infer<typeof ProductTelemetryEventSchema>;

export function parseProductTelemetryEvent(value: unknown): ProductTelemetryEvent {
  const parsed = ProductTelemetryEventSchema.safeParse(value);
  if (!parsed.success) throw new TypeError("Product telemetry violates the privacy-safe allowlist.");
  if (EXPECTED_DIRECTION[parsed.data.locale] !== parsed.data.direction) throw new TypeError("Product telemetry locale direction is invalid.");
  return parsed.data;
}
