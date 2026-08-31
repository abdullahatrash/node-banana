import { describe, expect, it } from "vitest";
import {
  ADMISSION_EXPOSURE_CATALOG_VERSION,
  admissionExposureFor,
  admissionPricingSnapshots,
} from "../catalog";

describe("admission exposure catalog", () => {
  it("returns a pinned exact zero ceiling for local deterministic work", () => {
    const exposure = admissionExposureFor({
      provider: "runtime",
      providerOperation: "digest_text",
      model: "sha256",
      serviceTier: "local",
    });

    expect(exposure).toMatchObject({
      schema: "workflow-step-admission-exposure/v1",
      certainty: "exact",
      serviceTier: "local",
      perAttemptCeiling: "0",
      currency: "USD",
      catalogVersion: ADMISSION_EXPOSURE_CATALOG_VERSION,
    });
    expect(exposure.pricingSnapshotIds).toHaveLength(1);
    expect(
      admissionPricingSnapshots(exposure.pricingSnapshotIds),
    ).toEqual([
      expect.objectContaining({
        id: exposure.pricingSnapshotIds[0],
        source: "builtin_catalog",
        price: "0",
        currency: "USD",
        version: ADMISSION_EXPOSURE_CATALOG_VERSION,
      }),
    ]);
  });

  it("does not invent a Gemini ceiling without bounded billable usage", () => {
    const exposure = admissionExposureFor({
      provider: "gemini",
      providerOperation:
        "generativelanguage.v1beta.models.generateContent",
      model: "gemini-2.5-flash",
      serviceTier: "standard",
    });

    expect(exposure).toEqual({
      schema: "workflow-step-admission-exposure/v1",
      provider: "gemini",
      providerOperation:
        "generativelanguage.v1beta.models.generateContent",
      model: "gemini-2.5-flash",
      serviceTier: "standard",
      certainty: "unknown",
      reason: "provider_contract_has_unbounded_billable_usage",
      perAttemptCeiling: null,
      currency: null,
      pricingSnapshotIds: [],
      catalogVersion: ADMISSION_EXPOSURE_CATALOG_VERSION,
      sourceReferences: [
        `catalog:${ADMISSION_EXPOSURE_CATALOG_VERSION}`,
        "https://ai.google.dev/gemini-api/docs/pricing",
      ],
    });
  });

  it("returns defensive Pricing Snapshot copies", () => {
    const exposure = admissionExposureFor({
      provider: "conformance",
      providerOperation: "generate_image",
      model: "golden-v1",
      serviceTier: "test",
    });
    const first = admissionPricingSnapshots(exposure.pricingSnapshotIds);
    first[0]!.effectiveFrom.setUTCFullYear(2000);

    expect(
      admissionPricingSnapshots(exposure.pricingSnapshotIds)[0]?.effectiveFrom,
    ).toEqual(new Date("2026-08-01T00:00:00.000Z"));
  });
});
