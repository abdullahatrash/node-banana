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
  | "critical_action_p95_ms"
  | "api_p95_ms"
  | "job_stage_p95_ms";

export interface PerformanceEvidence extends EvidenceEnvelope {
  kind: "performance";
  route: string;
  metric: PerformanceMetric;
  measured: number;
  cacheState: "cold" | "warm";
  userRegion: "mena";
  providerRegion: string;
  criticalAction: string | null;
  jobStage: string | null;
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
  | "reduced_motion"
  | "focus_restoration"
  | "live_updates"
  | "captions_transcripts"
  | "arabic_screen_reader";

export interface SupportedClient {
  id: string;
  engine: "chromium" | "webkit" | "gecko";
  version: string;
  capabilities: string[];
}

export interface PerformanceRequirement {
  id: string;
  route: string;
  clientId: string;
  locale: SupportedLocale;
  metric: PerformanceMetric;
  budget: number;
  cacheState: "cold" | "warm";
  userRegion: "mena";
  providerRegion: string;
  criticalAction: string | null;
  jobStage: string | null;
}

export interface AccessibilityEvidence extends EvidenceEnvelope {
  kind: "accessibility";
  route: string;
  criterion: AccessibilityCriterion;
  standard: "WCAG_2_2_AA";
}

export interface ReleaseFlag {
  id: string;
  buildId: string;
  ownerUserId: string;
  hypothesis: string;
  createdAt: Date;
  expiresAt: Date;
  rolloutPercent: number;
  safeDefault: "off";
  status: "active" | "retired";
  evidenceIds: string[];
  eligibility: { roles: string[]; entitlements: string[]; locales: SupportedLocale[] };
  dependencyFlagIds: string[];
  telemetryEventName: "release_flag_evaluated";
  rollback: { mode: "automatic" | "manual"; triggerMetric: "error_rate" | "latency" | "completion" | "conversion"; threshold: number; windowMinutes: number; ownerUserId: string };
}

export interface PublicIncident {
  id: string;
  severity: "minor" | "major" | "critical";
  status: "investigating" | "identified" | "monitoring" | "resolved";
  impactedServices: string[];
  startedAt: Date;
  resolvedAt: Date | null;
  publicSummary: Record<SupportedLocale, string>;
  operationOutcome: "none" | "waiting" | "blocked" | "failed_known" | "outcome_unknown";
  creditRisk: "none" | "at_risk" | "incorrect_charge";
  publishingRisk: "none" | "delay" | "duplicate" | "outcome_unknown";
}

export interface RecoveryObjective {
  dataClass: string;
  rpoSeconds: number;
  rtoSeconds: number;
  artifactDigest: string;
  backupEncryption: "AES_256_GCM" | "KMS_ENVELOPE";
  backupRegions: string[];
  pitrWindowSeconds: number;
  artifactReconciliation: boolean;
  externalEffectReconciliation: boolean;
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
  backupRegion: string;
  pitrVerified: boolean;
  artifactReconciliationVerified: boolean;
  externalEffectReconciliationVerified: boolean;
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
  resumable: boolean;
  cursorSchemaVersion: string;
  resumeCursorEvidenceDigest: string;
  compatibilityWindowStartsAt: Date;
  compatibilityWindowEndsAt: Date;
}

export interface ParityManifestCell {
  id: string;
  route: string;
  feature: string;
  state: string;
  role: string;
  entitlement: string;
  viewport: "mobile" | "tablet" | "desktop";
  direction: LayoutDirection;
}

export interface ParityRequirement {
  id: string;
  route: string;
  feature: string;
  state: string;
  role: string;
  entitlement: string;
  viewport: "mobile" | "tablet" | "desktop";
  direction: LayoutDirection;
  buildId: string;
  evaluatedAt: Date;
  expiresAt: Date;
  artifactDigest: string;
  evidenceIds: string[];
  productSignoffUserId: string | null;
  designSignoffUserId: string | null;
  engineeringSignoffUserId: string | null;
  qaSignoffUserId: string | null;
  localizationAccessibilitySignoffUserId: string | null;
  status: EvidenceOutcome;
}

export type ReleaseEvidence = PerformanceEvidence | AccessibilityEvidence;

export interface ReleaseReadinessInput {
  buildId: string;
  evaluatedAt: Date;
  requiredRoutes: string[];
  supportedClients: SupportedClient[];
  performanceRequirements: PerformanceRequirement[];
  requiredDataClasses: string[];
  requiredContracts: string[];
  requiredParityCells: ParityManifestCell[];
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
  | "PERFORMANCE_DIMENSION_MISMATCH"
  | "LOCALE_DIRECTION_MISMATCH"
  | "FLAG_EXPIRED"
  | "FLAG_UNSAFE_DEFAULT"
  | "FLAG_EVIDENCE_MISSING"
  | "FLAG_DEPENDENCY_INVALID"
  | "INCIDENT_ACTIVE"
  | "RECOVERY_OBJECTIVE_INVALID"
  | "RESTORE_DRILL_MISSING"
  | "RESTORE_DRILL_FAILED"
  | "CONTRACT_MIGRATION_UNSAFE"
  | "PARITY_UNVERIFIED"
  | "PARITY_CELL_MISSING"
  | "PARITY_DIMENSION_MISMATCH"
  | "PARITY_SIGNOFF_INVALID";

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
  parityMatrix: { requiredCells: number; passingCells: number };
  blockers: ReleaseBlocker[];
}
