import { canonicalDigest } from "@/lib/agent-tools/canonical";
import type { GenerationIntent, InspirationRightsEvidence, InspirationRightsSnapshot } from "./types";

const asDate = (value: Date | string) => value instanceof Date ? value : new Date(value);
export function hydrateRightsEvidence(value: InspirationRightsEvidence): InspirationRightsEvidence { return { ...structuredClone(value), issuedAt: asDate(value.issuedAt), verifiedAt: asDate(value.verifiedAt), expiresAt: value.expiresAt ? asDate(value.expiresAt) : null }; }
export function hydrateRightsSnapshot(value: InspirationRightsSnapshot): InspirationRightsSnapshot { return { ...structuredClone(value), evidence: value.evidence.map(hydrateRightsEvidence), createdAt: asDate(value.createdAt) }; }

export function rightsEvidenceDigest(value: Omit<InspirationRightsEvidence, "digest">): `sha256:${string}` {
  return canonicalDigest(value) as `sha256:${string}`;
}

export function validateRightsEvidence(input: {
  workspaceId: string;
  basis: GenerationIntent["rights"]["basis"];
  permittedRemix: GenerationIntent["rights"]["permittedRemix"];
  sourceAssetIds: string[];
  evidence: InspirationRightsEvidence[];
  at: Date;
}): { ok: true } | { ok: false; code: string } {
  const sources = [...new Set(input.sourceAssetIds)];
  if (sources.length !== input.sourceAssetIds.length || input.evidence.length !== sources.length) return { ok: false, code: "RIGHTS_SOURCE_COVERAGE_REQUIRED" };
  for (const sourceAssetId of sources) {
    const matches = input.evidence.filter((item) => item.sourceAssetId === sourceAssetId);
    if (matches.length !== 1) return { ok: false, code: "RIGHTS_SOURCE_COVERAGE_REQUIRED" };
    const value = matches[0]!;
    const { digest: claimedDigest, ...unsigned } = value;
    if (value.schema !== "inspiration-rights-evidence/v1" || value.workspaceId !== input.workspaceId || value.basis !== input.basis ||
      value.permittedRemix !== input.permittedRemix || claimedDigest !== rightsEvidenceDigest(unsigned) || !/^sha256:[a-f0-9]{64}$/.test(value.sourceDigest) ||
      value.issuedAt > value.verifiedAt || value.verifiedAt > input.at || (value.expiresAt !== null && value.expiresAt <= input.at) ||
      !value.scope.modelInputUse || !value.scope.commercialUse || (input.permittedRemix === "derivative" && !value.scope.derivativeUse) ||
      (input.basis !== "owned" && !value.evidenceDocumentAssetId && !value.sourceUrl)) return { ok: false, code: "RIGHTS_EVIDENCE_INVALID_OR_EXPIRED" };
  }
  return { ok: true };
}
