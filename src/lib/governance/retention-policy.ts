import type { RetentionClass, RetentionRule } from "./types";

/**
 * Server-owned legal minima. Workspace commands may echo these values for a
 * useful review experience, but can never lower or redefine them.
 */
export const TRUSTED_RETENTION_LEGAL_FLOORS = Object.freeze({
  recoverable_draft: 0,
  workspace_media: 0,
  published_lineage: 90,
  consent_evidence: 365,
  security_evidence: 365,
  billing_tax_evidence: 365,
  provider_diagnostic: 30,
  support_attachment: 30,
} satisfies Record<RetentionClass, number>);

export function trustedRetentionRule(rule: RetentionRule): RetentionRule {
  return { ...rule, legalFloorDays: TRUSTED_RETENTION_LEGAL_FLOORS[rule.retentionClass] };
}
