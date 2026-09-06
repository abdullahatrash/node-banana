import { describe, expect, it } from "vitest"
import { aggregateObservedMetric, ANALYTICS_METRIC_CONTRACTS } from "../analytics-metrics"

describe("analytics metric contracts", () => {
  it("keeps absent observations unknown rather than manufacturing zero", () => {
    expect(aggregateObservedMetric([{ metadata: {} }], "websiteViews")).toBeNull()
    expect(aggregateObservedMetric([{ metadata: { websiteViews: 0 } }], "websiteViews")).toBe(0)
  })

  it("separates metrics with incompatible collection semantics", () => {
    expect(ANALYTICS_METRIC_CONTRACTS.views.comparisonGroup).not.toBe(ANALYTICS_METRIC_CONTRACTS.websiteViews.comparisonGroup)
    expect(ANALYTICS_METRIC_CONTRACTS.geoCitations.source).toBe("geo_observation")
  })
})
