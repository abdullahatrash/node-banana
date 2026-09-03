import { findCuratedModel } from "./catalog";
import type { CompatibilityFailure, CostQuote, ExactModelRef, FallbackAuthorization, GenerationQuality, ModelDescriptor } from "./types";

const rank: Record<GenerationQuality, number> = { preview: 0, standard: 1, premium: 2 };
const same = (a: ExactModelRef, b: ExactModelRef) => a.provider === b.provider && a.model === b.model && a.version === b.version && a.inputSchemaDigest === b.inputSchemaDigest;

export function authorizeFallback(input: { authorization: FallbackAuthorization; target: ExactModelRef; quote: CostQuote; at: Date; resolveModel?: (ref: ExactModelRef) => ModelDescriptor | null }): { authorized: true } | { authorized: false; reasons: CompatibilityFailure[] } {
  const { authorization: grant, target, quote, at } = input; const model = (input.resolveModel ?? findCuratedModel)(target); const reasons: CompatibilityFailure[] = [];
  if (!grant.targets.some((item) => same(item, target))) reasons.push("target_not_authorized");
  if (grant.revokedAt) reasons.push("revoked");
  if (grant.expiresAt <= at) reasons.push("expired");
  if (!model?.capabilities.includes(grant.capability)) reasons.push("capability");
  if (!model || rank[model.quality] < rank[grant.minimumQuality]) reasons.push("quality");
  if (!model?.contentLanguages.includes(grant.contentLanguage)) reasons.push("content_language");
  if (grant.arabicVariety && !model?.arabicVarieties.includes(grant.arabicVariety)) reasons.push("arabic_variety");
  if (!model?.verifiedRegions.includes(grant.verifiedRegion)) reasons.push("region");
  if (!model?.executionModes.includes(grant.executionMode)) reasons.push("execution_mode");
  if (quote.expiresAt <= at) reasons.push("quote_expired");
  if (quote.basis !== grant.sourceQuote.basis || quote.amount > grant.sourceQuote.maxUnitAmount) reasons.push("source_quote");
  if (quote.amount * quote.quantity > grant.maxTotalCostUsd) reasons.push("cost_ceiling");
  return reasons.length ? { authorized: false, reasons } : { authorized: true };
}
