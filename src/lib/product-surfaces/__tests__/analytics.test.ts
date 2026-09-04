import { describe, expect, it } from "vitest";
import { PRODUCT_RECORD_KINDS, parseProductPayload } from "../definitions";
describe("analytics sources", () => { it("supports explicit Website and GEO configurations", () => { expect(PRODUCT_RECORD_KINDS).toContain("website_analytics_source"); expect(PRODUCT_RECORD_KINDS).toContain("geo_analytics_source"); expect(() => parseProductPayload("geo_analytics_source", { domain: "example.com", topics: ["Arabic commerce"], enabled: true, lastObservationAt: null })).not.toThrow(); }); });
