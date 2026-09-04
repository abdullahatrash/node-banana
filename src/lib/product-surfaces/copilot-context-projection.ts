import type { DashboardReadModel } from "./dashboard"

export const PRODUCT_COPILOT_CAPABILITIES = ["explain_workspace_readiness", "navigate_recommended_action"] as const

export type ProductCopilotBrandPin = {
  profileId: string
  revision: number
  digest: `sha256:${string}`
  acceptedAt: Date
  contentLanguage: "ar" | "en" | "mixed"
  arabicVariety: "msa" | "gulf" | "egyptian" | "levantine" | "maghrebi" | "other" | null
}

export function projectProductCopilotContext(input: {
  dashboard: Pick<DashboardReadModel, "nextAction" | "sourceEnvelopes">
  brand: ProductCopilotBrandPin | null
  generatedAt: Date
}) {
  return {
    schema: "product-copilot-context/v1" as const,
    suggestion: { ...input.dashboard.nextAction, generatedAt: input.generatedAt.toISOString() },
    brand: input.brand ? {
      profileId: input.brand.profileId,
      revision: input.brand.revision,
      digest: input.brand.digest,
      acceptedAt: input.brand.acceptedAt.toISOString(),
    } : null,
    language: {
      contentLanguage: input.brand?.contentLanguage ?? null,
      arabicVariety: input.brand?.arabicVariety ?? null,
      basis: input.brand ? "active_brand_profile" as const : "unavailable" as const,
    },
    capabilities: [...PRODUCT_COPILOT_CAPABILITIES],
    evidence: input.dashboard.sourceEnvelopes.map((source) => ({
      source: source.source,
      status: source.status,
      count: source.count,
      observedAt: source.updatedAt?.toISOString() ?? null,
      freshness: freshness(source.updatedAt, input.generatedAt),
      href: source.href,
    })),
    generatedAt: input.generatedAt.toISOString(),
  }
}

function freshness(observedAt: Date | null, generatedAt: Date): "current" | "stale" | "unknown" {
  if (!observedAt) return "unknown"
  return generatedAt.getTime() - observedAt.getTime() <= 86_400_000 ? "current" : "stale"
}
