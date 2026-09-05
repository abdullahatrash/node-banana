import { describe, expect, it, vi } from "vitest";

import { LicensedTrendCatalogError } from "../licensed-trend-catalog";
import {
  applyLicensedTrendProviderEvent,
  providerFailureCode,
  providerFailureState,
} from "../licensed-trend-provider-inbox";

describe("licensed trend provider inbox behavior", () => {
  it("binds catalog-state commands to the authenticated provider", async () => {
    const setState = vi.fn().mockResolvedValue({ state: "paused" });
    const result = await applyLicensedTrendProviderEvent({
      providerKey: "licensed.partner",
      payload: {
        schema: "licensed-trend-provider-event/v1",
        action: "set_catalog_state",
        catalogId: "catalog-1",
        state: "paused",
      },
      effects: { publish: vi.fn(), setState },
    });
    expect(result).toEqual({ state: "paused" });
    expect(setState).toHaveBeenCalledWith({
      providerKey: "licensed.partner",
      catalogId: "catalog-1",
      state: "paused",
    });
  });

  it("fails known catalog conflicts immediately but retries object-delivery races", () => {
    expect(providerFailureState({
      error: new LicensedTrendCatalogError("CATALOG_REVISION_IMMUTABLE"),
      attempt: 1,
      maxAttempts: 8,
    })).toBe("failed_known");
    expect(providerFailureState({
      error: new LicensedTrendCatalogError("CATALOG_OBJECT_IDENTITY_MISMATCH"),
      attempt: 1,
      maxAttempts: 8,
    })).toBe("queued");
    expect(providerFailureState({ error: new Error("timeout"), attempt: 8, maxAttempts: 8 }))
      .toBe("outcome_unknown");
    expect(providerFailureCode(new Error("secret provider response")))
      .toBe("LICENSED_TREND_PROVIDER_PROCESSING_FAILED");
  });
});
