export type SupportedLocale = "ar" | "en";
export type LayoutDirection = "rtl" | "ltr";

export type EvidenceOutcome = "passed" | "failed" | "unknown" | "skipped";

export interface EvidenceEnvelope {
  id: string;
  buildId: string;
  collectedAt: Date;
  expiresAt: Date;
  artifactDigest: string;
  outcome: EvidenceOutcome;
  locale: SupportedLocale;
  direction: LayoutDirection;
  client: string;
}

export type PerformanceMetric =
  | "largest_contentful_paint_ms"
  | "interaction_to_next_paint_ms"
  | "cumulative_layout_shift_milli"
  | "api_p95_ms"
  | "job_stage_p95_ms";

export interface PerformanceEvidence extends EvidenceEnvelope {
  kind: "performance";
  route: string;
  metric: PerformanceMetric;
  measured: number;
  budget: number;
}

export type AccessibilityCriterion =
  | "keyboard"
  | "focus_visible"
  | "focus_order"
  | "contrast"
  | "accessible_name"
  | "error_identification"
  | "language_metadata"
  | "rtl_layout"
  | "reflow"
  | "target_size"
  | "reduced_motion";

export interface AccessibilityEvidence extends EvidenceEnvelope {
  kind: "accessibility";
  route: string;
  criterion: AccessibilityCriterion;
  standard: "WCAG_2_2_AA";
}

export interface ReleaseFlag {
  id: string;
  ownerUserId: string;
  hypothesis: string;
  createdAt: Date;
  expiresAt: Date;
  rolloutPercent: number;
  safeDefault: "off";
  status: "active" | "retired";
  evidenceIds: string[];
}

export interface PublicIncident {
  id: string;
  severity: "minor" | "major" | "critical";
  status: "investigating" | "identified" | "monitoring" | "resolved";
  impactedServices: string[];
  startedAt: Date;
  resolvedAt: Date | null;
  publicSummary: Record<SupportedLocale, string>;
}

export interface RecoveryObjective {
  dataClass: string;
  rpoSeconds: number;
  rtoSeconds: number;
  artifactDigest: string;
}

export interface RestoreDrillEvidence {
  id: string;
  dataClass: string;
  buildId: string;
  startedAt: Date;
  completedAt: Date;
  observedDataLossSeconds: number;
  observedRecoverySeconds: number;
  outcome: EvidenceOutcome;
  expiresAt: Date;
  artifactDigest: string;
}

export interface ContractMigrationEvidence {
  id: string;
  contract: string;
  buildId: string;
  phase: "expand" | "migrate" | "contract";
  status: "planned" | "running" | "verified" | "failed" | "rolled_back";
  compatibilityVerified: boolean;
  rollbackVerified: boolean;
  observedAt: Date;
  expiresAt: Date;
  artifactDigest: string;
}

export interface ParityRequirement {
  id: string;
  feature: string;
  buildId: string;
  evaluatedAt: Date;
  expiresAt: Date;
  artifactDigest: string;
  requiredLocales: SupportedLocale[];
  evidenceIds: string[];
  productSignoffUserId: string | null;
  engineeringSignoffUserId: string | null;
  status: EvidenceOutcome;
}

export type ReleaseEvidence = PerformanceEvidence | AccessibilityEvidence;

export interface ReleaseReadinessInput {
  buildId: string;
  evaluatedAt: Date;
  requiredRoutes: string[];
  supportedClients: string[];
  requiredDataClasses: string[];
  requiredContracts: string[];
  requiredParityRequirementIds: string[];
  evidence: ReleaseEvidence[];
  flags: ReleaseFlag[];
  incidents: PublicIncident[];
  recoveryObjectives: RecoveryObjective[];
  restoreDrills: RestoreDrillEvidence[];
  contractMigrations: ContractMigrationEvidence[];
  parity: ParityRequirement[];
}

export type ReleaseBlockerCode =
  | "RELEASE_MANIFEST_INVALID"
  | "RELEASE_INVENTORY_MISSING"
  | "ATTESTATION_INVALID"
  | "EVIDENCE_MISSING"
  | "EVIDENCE_STALE"
  | "EVIDENCE_FAILED"
  | "EVIDENCE_UNRESOLVED"
  | "PERFORMANCE_BUDGET_EXCEEDED"
  | "LOCALE_DIRECTION_MISMATCH"
  | "FLAG_EXPIRED"
  | "FLAG_UNSAFE_DEFAULT"
  | "FLAG_EVIDENCE_MISSING"
  | "INCIDENT_ACTIVE"
  | "RECOVERY_OBJECTIVE_INVALID"
  | "RESTORE_DRILL_MISSING"
  | "RESTORE_DRILL_FAILED"
  | "CONTRACT_MIGRATION_UNSAFE"
  | "PARITY_UNVERIFIED";

export interface ReleaseBlocker {
  code: ReleaseBlockerCode;
  subject: string;
  detail: string;
}

export interface ReleaseReadinessDecision {
  schema: "release-readiness-decision/v1";
  buildId: string;
  evaluatedAt: Date;
  releasable: boolean;
  parityClaimAllowed: boolean;
  blockers: ReleaseBlocker[];
}
