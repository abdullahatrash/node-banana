import type { BrandProfileV1 } from "@/lib/onboarding/schemas"

export const BRAND_DIFF_FIELDS = [
  "contentLanguage", "identity", "offering", "audiences", "problems", "benefits",
  "differentiators", "mission", "positioning", "ownedSpace", "businessModel",
  "categories", "voice", "prohibitedClaims", "prohibitedTopics", "competitors",
  "contentAngles", "uncertainties", "evidence", "sources",
] as const

export type BrandDiffField = (typeof BRAND_DIFF_FIELDS)[number]

function stableValue(value: unknown): string {
  if (Array.isArray(value)) return JSON.stringify(value.map(stableValue))
  if (value && typeof value === "object") {
    return JSON.stringify(Object.entries(value).sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => [key, stableValue(item)]))
  }
  return JSON.stringify(value)
}

export function diffBrandProfiles(current: BrandProfileV1, previous: BrandProfileV1 | null): BrandDiffField[] {
  if (!previous) return BRAND_DIFF_FIELDS.slice()
  const values: Record<BrandDiffField, [unknown, unknown]> = {
    contentLanguage: [current.contentLanguage, previous.contentLanguage],
    identity: [current.identity, previous.identity], offering: [current.offering, previous.offering],
    audiences: [current.audiences, previous.audiences], problems: [current.problems, previous.problems],
    benefits: [current.benefits, previous.benefits], differentiators: [current.differentiators, previous.differentiators],
    mission: [current.mission, previous.mission], positioning: [current.positioning, previous.positioning],
    ownedSpace: [current.ownedSpace, previous.ownedSpace], businessModel: [current.businessModel, previous.businessModel],
    categories: [current.categories, previous.categories], voice: [current.voice, previous.voice],
    prohibitedClaims: [current.prohibitedClaims, previous.prohibitedClaims], prohibitedTopics: [current.prohibitedTopics, previous.prohibitedTopics],
    competitors: [current.competitors, previous.competitors], contentAngles: [current.contentAngles, previous.contentAngles],
    uncertainties: [current.uncertainties, previous.uncertainties], evidence: [current.evidence, previous.evidence],
    sources: [current.sourceIds, previous.sourceIds],
  }
  return BRAND_DIFF_FIELDS.filter((field) => stableValue(values[field][0]) !== stableValue(values[field][1]))
}
