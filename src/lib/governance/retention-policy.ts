import { RETENTION_CLASSES, type RetentionClass, type RetentionRule } from "./types";

export const MAX_RETENTION_DURATION_DAYS = 36_500;

/**
 * Server-owned legal minima. Workspace commands may echo these values for a
 * useful review experience, but can never lower or redefine them.
 */
export const TRUSTED_RETENTION_LEGAL_FLOORS = Object.freeze({
  recoverable_draft: 0,
  workspace_media: 0,
  published_lineage: 90,
  consent_evidence: 365,
  generation_rights_evidence: 365,
  security_evidence: 365,
  billing_tax_evidence: 365,
  provider_diagnostic: 30,
  support_attachment: 30,
} satisfies Record<RetentionClass, number>);

export function trustedRetentionRule(rule: RetentionRule): RetentionRule {
  return { ...rule, legalFloorDays: TRUSTED_RETENTION_LEGAL_FLOORS[rule.retentionClass] };
}

/** Keeps retention.manage@1 wire compatibility while making old eight-class
 * clients publish an explicit, conservative generation-rights rule. */
export function normalizeRetentionPolicyRules(rules: RetentionRule[]): RetentionRule[] {
  if (rules.some((rule) => rule.retentionClass === "generation_rights_evidence")) return rules;
  const legacyClasses = RETENTION_CLASSES.filter((retentionClass) => retentionClass !== "generation_rights_evidence");
  if (rules.length !== legacyClasses.length || new Set(rules.map((rule) => rule.retentionClass)).size !== legacyClasses.length
    || legacyClasses.some((retentionClass) => !rules.some((rule) => rule.retentionClass === retentionClass))) return rules;
  const consent = rules.find((rule) => rule.retentionClass === "consent_evidence")!;
  const durationDays = Math.max(consent.durationDays, TRUSTED_RETENTION_LEGAL_FLOORS.generation_rights_evidence);
  return [...rules, {
    retentionClass: "generation_rights_evidence",
    durationDays,
    recoverableDays: Math.min(consent.recoverableDays, durationDays),
    legalFloorDays: TRUSTED_RETENTION_LEGAL_FLOORS.generation_rights_evidence,
  }];
}
