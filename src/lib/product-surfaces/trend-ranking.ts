import { canonicalDigest } from "@/lib/agent-tools/canonical";
import type { TrendIngestionCandidate, TrendRankingContext, TrendRankingEvidence, TrendRightsStatus } from "./trend-types";

const WEIGHTS = { freshness: 15, recency: 10, performance: 10, brandFit: 15, region: 10, language: 10, arabicVariety: 5, format: 10, rights: 10, preference: 5 } as const;
const MENA_REGIONS = new Set(["mena", "gcc", "gulf", "sa", "saudi arabia", "ae", "uae", "eg", "egypt", "kw", "qa", "bh", "om", "jo", "lb", "ma", "dz", "tn", "iq"]);

function normalized(value: string) { return value.normalize("NFKC").trim().toLocaleLowerCase("und"); }
function tokens(values: string[]) { return new Set(values.flatMap((value) => normalized(value).match(/[\p{L}\p{N}]+/gu) ?? []).filter((value) => value.length > 1)); }
function ageHours(then: string, now: Date) { return Math.max(0, (now.getTime() - new Date(then).getTime()) / 3_600_000); }
function freshness(hours: number) { return hours <= 6 ? 100 : hours <= 24 ? 85 : hours <= 72 ? 65 : hours <= 168 ? 40 : hours <= 720 ? 15 : 0; }
function recency(hours: number) { return hours <= 24 ? 100 : hours <= 72 ? 80 : hours <= 168 ? 60 : hours <= 720 ? 25 : 5; }
function rightsScore(status: TrendRightsStatus) { return { licensed: 100, user_submitted: 90, embeddable: 65, metadata_only: 45, restricted: 0 }[status]; }

export function rankTrendCandidate(input: { candidate: TrendIngestionCandidate; context: TrendRankingContext; evaluatedAt: Date }): TrendRankingEvidence {
  const { candidate, context, evaluatedAt } = input;
  const candidateTokens = tokens([candidate.title, ...candidate.tags]);
  const brandTokens = tokens(context.brandProfile?.keywords ?? []);
  const matchedBrandTokens = [...brandTokens].filter((item) => candidateTokens.has(item)).length;
  const brandFit = brandTokens.size === 0 ? 50 : Math.round(30 + 70 * matchedBrandTokens / brandTokens.size);
  const normalizedRegion = normalized(candidate.region);
  const preferredRegions = context.preferredRegions.map(normalized);
  const region = preferredRegions.includes(normalizedRegion) ? 100 : MENA_REGIONS.has(normalizedRegion) && (context.brandProfile?.contentLanguage === "ar" || preferredRegions.some((item) => MENA_REGIONS.has(item))) ? 85 : preferredRegions.length ? 25 : 50;
  const language = context.brandProfile ? candidate.contentLanguage === context.brandProfile.contentLanguage ? 100 : 20 : 50;
  const arabicVariety = candidate.contentLanguage !== "ar" ? 50 : context.preferredArabicVarieties.length === 0 ? 75 : candidate.arabicVariety && context.preferredArabicVarieties.includes(candidate.arabicVariety) ? 100 : candidate.arabicVariety === null ? 70 : 40;
  const format = context.preferredFormats.length === 0 ? 50 : context.preferredFormats.includes(candidate.format) ? 100 : 25;
  const preferredTags = new Set(context.preferredTags.map(normalized));
  const excludedTags = new Set(context.excludedTags.map(normalized));
  const candidateTags = candidate.tags.map(normalized);
  const excluded = candidateTags.some((item) => excludedTags.has(item));
  const preference = excluded ? 0 : candidateTags.some((item) => preferredTags.has(item)) ? 100 : preferredTags.size ? 40 : 50;
  const evidenceCurrent = !candidate.rights.expiresAt || new Date(candidate.rights.expiresAt) > evaluatedAt;
  const eligibleForDiscovery = candidate.rights.status !== "restricted" && evidenceCurrent;
  const eligibleForBlitz = eligibleForDiscovery
    && candidate.rights.status !== "metadata_only"
    && Boolean(candidate.rights.sourceAssetId && candidate.rights.sourceMediaType && candidate.rights.rightsSnapshot);
  const signals = {
    freshness: freshness(ageHours(candidate.metricsObservedAt, evaluatedAt)),
    recency: recency(ageHours(candidate.sourcePublishedAt, evaluatedAt)),
    performance: Math.min(100, Math.round(Math.log10((candidate.metrics.views ?? 0) + (candidate.metrics.likes ?? 0) * 4 + (candidate.metrics.comments ?? 0) * 8 + 1) * 20)),
    brandFit, region, language, arabicVariety, format,
    rights: evidenceCurrent ? rightsScore(candidate.rights.status) : 0,
    preference,
  };
  const score = Math.round(Object.entries(WEIGHTS).reduce((sum, [key, weight]) => sum + signals[key as keyof typeof signals] * weight, 0));
  const reasonCodes = [
    ...(signals.freshness >= 85 ? ["fresh_metrics"] : signals.freshness === 0 ? ["stale_metrics"] : []),
    ...(signals.recency >= 80 ? ["recent_source"] : []),
    ...(signals.performance >= 80 ? ["strong_performance"] : []),
    ...(signals.brandFit >= 80 ? ["brand_topic_match"] : []),
    ...(signals.region === 100 ? ["mena_region_match"] : signals.region === 85 ? ["mena_region_relevant"] : []),
    ...(signals.language === 100 ? ["content_language_match"] : []),
    ...(signals.arabicVariety === 100 ? ["arabic_variety_match"] : []),
    ...(signals.format === 100 ? ["preferred_format"] : []),
    ...({ licensed: ["licensed_rights"], user_submitted: ["user_submitted_rights"], embeddable: ["embeddable_rights"], metadata_only: ["metadata_only_rights"], restricted: ["rights_restricted"] }[candidate.rights.status]),
    ...(excluded ? ["explicit_preference_excluded"] : signals.preference === 100 ? ["explicit_preference_match"] : []),
    ...(!evidenceCurrent ? ["rights_expired"] : []),
  ];
  const unsigned = {
    schema: "inspiration-trend-ranking/v1" as const, score, signals, reasonCodes,
    brandProfile: context.brandProfile ? { id: context.brandProfile.id, revision: context.brandProfile.revision, digest: context.brandProfile.digest as `sha256:${string}` } : null,
    eligibleForDiscovery, eligibleForBlitz, evaluatedAt: evaluatedAt.toISOString(),
  };
  return { ...unsigned, digest: canonicalDigest(unsigned) as `sha256:${string}` };
}
