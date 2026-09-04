import { describe, expect, it } from "vitest"
import { brandProfileV1Schema } from "@/lib/onboarding/schemas"
import { diffBrandProfiles } from "../brand-projection"

const profile = brandProfileV1Schema.parse({
  schemaVersion: 1, contentLanguage: "ar", identity: { companyName: "Tasmeemai", coreIdentity: "Arabic creative tools", logoAssetId: null },
  offering: ["Studio"], audiences: [{ name: "Creators", description: "Arabic creators", weight: 100 }], problems: [], benefits: ["Fast"], differentiators: ["Arabic-first"],
  mission: "Help creators", positioning: "Trusted studio", ownedSpace: "Arabic creation", businessModel: "b2b", categories: ["saas"],
  voice: { descriptors: ["clear"], do: [], doNot: [] }, prohibitedClaims: [], prohibitedTopics: [], competitors: [], contentAngles: ["Education"], uncertainties: [],
  evidence: [{ sourceId: "source_1", excerptHash: `sha256:${"a".repeat(64)}` }], sourceIds: ["source_1"],
})

describe("Brand revision projection", () => {
  it("returns only fields that changed between immutable revisions", () => {
    expect(diffBrandProfiles({ ...profile, benefits: ["Fast", "Safe"], contentLanguage: "en" }, profile)).toEqual(["contentLanguage", "benefits"])
  })

  it("marks every field as introduced for the first revision", () => {
    expect(diffBrandProfiles(profile, null)).toContain("sources")
  })
})
