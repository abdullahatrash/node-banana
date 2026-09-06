import { describe, expect, it } from "vitest";
import { serializableFailure } from "@/../workflows/onboarding-brand-analysis";

describe("onboarding workflow error contract", () => {
  it("preserves stable source and model errors after workflow retries", () => {
    expect(
      serializableFailure(
        new Error("ONBOARDING_ANALYSIS_FAILURE:false:SOURCE_BLOCKED"),
      ),
    ).toEqual({ code: "SOURCE_BLOCKED", retryable: false });
    expect(
      serializableFailure(
        new Error(
          "ONBOARDING_ANALYSIS_FAILURE:true:BRAND_PROFILE_GENERATION_FAILED",
        ),
      ),
    ).toEqual({ code: "BRAND_PROFILE_GENERATION_FAILED", retryable: true });
  });

  it("redacts arbitrary failures behind a stable internal code", () => {
    expect(serializableFailure(new Error("secret provider response"))).toEqual({
      code: "ANALYSIS_INTERNAL_ERROR",
      retryable: true,
    });
  });
});
