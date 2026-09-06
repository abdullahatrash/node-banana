import { beforeEach, describe, expect, it, vi } from "vitest";

const { updateProductRecord, validateCampaignAuthoringPayload, database, databaseRows, assertActiveAutomationCapacityWith, MockCommercialEntitlementError } = vi.hoisted(() => {
  const rows: unknown[] = [];
  return {
    updateProductRecord: vi.fn(),
    validateCampaignAuthoringPayload: vi.fn(),
    database: { select: vi.fn() },
    databaseRows: rows,
    assertActiveAutomationCapacityWith: vi.fn(),
    MockCommercialEntitlementError: class CommercialEntitlementError extends Error {
      constructor(readonly code: string) { super(code); }
    },
  };
});

vi.mock("@/lib/db", () => ({ getDb: () => database }));
vi.mock("@/lib/product-surfaces/repository", () => ({ updateProductRecord }));
vi.mock("@/lib/product-surfaces/campaign-authoring", () => ({ validateCampaignAuthoringPayload }));
vi.mock("@/lib/commercial/entitlements", () => ({
  assertActiveAutomationCapacityWith,
  CommercialEntitlementError: MockCommercialEntitlementError,
}));
vi.mock("@/lib/product-surfaces/campaign-quote", () => ({
  CampaignQuoteError: class CampaignQuoteError extends Error { constructor(readonly code: string) { super(code); } },
  issueCampaignAcceptedQuote: () => ({
    quote: {
      quoteId: "quote-1", amount: "1.00", currency: "USD",
      expiresAt: "2026-09-05T01:00:00.000Z",
      ceiling: { maximumProviderAttempts: 1 },
      providerModels: [],
    },
    ref: "accepted-quote-ref",
  }),
}));

import { activateCampaignCommand } from "../campaign-runtime";

const digest = `sha256:${"a".repeat(64)}`;
const record = {
  id: "campaign-1", workspaceId: "workspace-1", kind: "campaign_automation", state: "draft", title: "Launch", revision: 4,
  payload: {
    currentStep: 10, name: "Launch", formatMix: { slideshow: 100 }, remixRatio: 50, inspirationIds: [],
    brandProfileRef: { id: "brand-1", revision: 2, digest }, contentLanguage: "ar", arabicVariety: "msa",
    personaIds: [], demoAssetIds: [], mediaSetIds: [], themeRevisionRefs: [], channelIds: ["channel-1"], variantsPerChannel: 1,
    cadence: { timezone: "Asia/Riyadh", weekStart: 0, startAt: null, endAt: null, postsPerWeek: 3, calendarCapacity: 20 },
    execution: { mode: "managed", modelPolicy: "workspace-default", creditCeiling: 20, budgetCents: 5000, replenishmentMode: "manual", blitzTargetCapacity: 20, blitzMaximumCreatesPerRun: 10, workflow: { workflowId: "workflow-1", workflowRevisionId: "revision-1", inputs: { brief: "Launch" }, inputArtifactIds: [] } },
    reviewMode: "request_human", autoPublishGrantId: null, validationErrors: [], runtime: null,
  },
};

describe("campaign activation ordering", () => {
  beforeEach(() => {
    updateProductRecord.mockReset();
    validateCampaignAuthoringPayload.mockReset().mockResolvedValue({ issues: [] });
    assertActiveAutomationCapacityWith.mockReset().mockResolvedValue({});
    databaseRows.splice(0, databaseRows.length, record);
    database.select.mockReset().mockReturnValue({
      from: () => ({ where: () => ({ limit: async () => databaseRows }) }),
    });
  });

  it("does not move a draft to validating when admission is denied", async () => {
    const runtime = {
      preview: vi.fn().mockResolvedValue({ admissible: false, denialReasons: ["BUDGET_LIMIT_EXCEEDED"], warnings: [], evaluatedAt: new Date("2026-09-04T00:00:00.000Z"), ceiling: { amount: null, currency: null, certainty: "unavailable" }, stepExposures: [] }),
      start: vi.fn(),
    };

    await expect(activateCampaignCommand({ workspaceId: "workspace-1", userId: "user-1", authContextId: "session-1", id: "campaign-1", expectedRevision: 4, idempotencyKey: "activation-1", runtime })).rejects.toMatchObject({ code: "BUDGET_LIMIT_EXCEEDED" });
    expect(updateProductRecord).not.toHaveBeenCalled();
    expect(runtime.start).not.toHaveBeenCalled();
  });

  it("reserves an Automation slot before starting any provider-backed workflow", async () => {
    const runtime = {
      preview: vi.fn().mockResolvedValue({
        admissible: true,
        denialReasons: [], warnings: [], evaluatedAt: new Date("2026-09-05T00:00:00.000Z"),
        ceiling: { amount: "1.00", currency: "USD", certainty: "exact" }, stepExposures: [],
      }),
      start: vi.fn(),
    };
    updateProductRecord.mockImplementationOnce(async (input: { beforeUpdate?: (executor: object) => Promise<void> }) => {
      await input.beforeUpdate?.({});
      return { ...record, state: "validating", revision: 5 };
    });
    assertActiveAutomationCapacityWith.mockRejectedValueOnce(
      new MockCommercialEntitlementError("PLAN_ACTIVE_AUTOMATION_LIMIT_REACHED"),
    );

    await expect(activateCampaignCommand({ workspaceId: "workspace-1", userId: "user-1", authContextId: "session-1", id: "campaign-1", expectedRevision: 4, idempotencyKey: "activation-2", runtime })).rejects.toMatchObject({ code: "PLAN_ACTIVE_AUTOMATION_LIMIT_REACHED" });
    expect(assertActiveAutomationCapacityWith).toHaveBeenCalledWith({}, expect.objectContaining({ workspaceId: "workspace-1", excludeRecordId: "campaign-1" }));
    expect(runtime.start).not.toHaveBeenCalled();
  });
});
