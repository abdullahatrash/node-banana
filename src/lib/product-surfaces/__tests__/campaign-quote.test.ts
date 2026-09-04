import { describe, expect, it, vi } from "vitest";
import type { RunAdmissionPreview } from "@/lib/agent-runtime/budgets/types";
import { issueCampaignAcceptedQuote } from "../campaign-quote";

function preview(input: { admissible?: boolean; exact?: boolean } = {}): RunAdmissionPreview {
  const admissible = input.admissible ?? true;
  const exact = input.exact ?? true;
  return {
    schema: "run-admission-preview/v1", workspaceId: "workspace_1", principalId: "user_1", workflowId: "workflow_1", workflowRevisionId: "revision_1", evaluatedAt: new Date("2026-09-04T00:00:00.000Z"),
    ceiling: { amount: exact ? "0.35" : null, currency: exact ? "USD" : null, certainty: exact ? "conservative" : "unknown", fxSnapshotIds: [] },
    applicableCredentialSpendGrants: [], applicablePolicies: [], requiredReservations: [], warnings: [], admissible, denialReasons: admissible ? [] : ["BUDGET_LIMIT_EXCEEDED"],
    stepExposures: exact ? [{ stepId: "generate", provider: "replicate", providerOperation: "predict", model: "model@version", serviceTier: "standard", automaticAttempts: 1, credentialSlotId: "provider", credentialProfileId: "credential_1", amountPerAttempt: "0.35", currency: "USD", pricingSnapshotIds: ["price_1"], pricingSource: "builtin_catalog" }] : [],
  };
}

const base = { binding: { workflowId: "workflow_1", workflowRevisionId: "revision_1", inputs: { prompt: "Arabic launch" }, inputArtifactIds: [] }, workspaceId: "workspace_1", userId: "user_1", keyId: "session_1", campaignId: "campaign_1", campaignRevision: 2, now: new Date("2026-09-04T00:00:00.000Z") };

describe("campaign accepted quote", () => {
  it("pins exact provider pricing and the immutable campaign target", () => {
    const seal = vi.fn(() => "signed.quote");
    const result = issueCampaignAcceptedQuote({ ...base, preview: preview(), codec: { seal } });
    expect(result.ref).toBe("signed.quote");
    expect(result.quote).toMatchObject({ amount: "0.35", currency: "USD", workflowRevisionId: "revision_1", delegatedPrincipalId: "user_1", ceiling: { maximumAmount: "0.35", maximumProviderAttempts: 1 } });
    expect(result.quote.ceilingDigest).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(seal).toHaveBeenCalledOnce();
  });

  it("can bind a stable launch quote identity for crash-safe replay", () => {
    const result = issueCampaignAcceptedQuote({ ...base, preview: preview(), quoteId: "quote_campaign_revision_2", codec: { seal: vi.fn(() => "signed.quote") } });
    expect(result.quote.quoteId).toBe("quote_campaign_revision_2");
  });

  it("fails closed for denied or inexact pricing", () => {
    expect(() => issueCampaignAcceptedQuote({ ...base, preview: preview({ admissible: false }), codec: { seal: vi.fn() } })).toThrow("BUDGET_LIMIT_EXCEEDED");
    expect(() => issueCampaignAcceptedQuote({ ...base, preview: preview({ exact: false }), codec: { seal: vi.fn() } })).toThrow("CAMPAIGN_EXACT_QUOTE_UNAVAILABLE");
  });
});
