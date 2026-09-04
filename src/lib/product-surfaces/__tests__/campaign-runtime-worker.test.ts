import { describe, expect, it, vi } from "vitest";
import { ProductCampaignRuntimeWorker } from "../campaign-runtime-worker-service";

const now = new Date("2026-09-06T00:00:00Z");
const payload = {
  currentStep: 10, name: "Arabic launch", formatMix: { slideshow: 100 }, remixRatio: 50, inspirationIds: [], contentLanguage: "ar", arabicVariety: "gulf", personaIds: [], mediaSetIds: [], channelIds: ["channel"], variantsPerChannel: 1,
  cadence: { timezone: "Asia/Riyadh", weekStart: 6, startAt: null, endAt: null, postsPerWeek: 3 },
  execution: { mode: "managed", modelPolicy: "workspace-default", creditCeiling: 20, budgetCents: 4_000, replenishmentMode: "daily", blitzTargetCapacity: 20, blitzMaximumCreatesPerRun: 5, workflow: { workflowId: "workflow", workflowRevisionId: "revision", inputs: {}, inputArtifactIds: [] } },
  reviewMode: "request_human", autoPublishGrantId: null, validationErrors: [],
  runtime: { runId: "run", workflowId: "workflow", workflowRevisionId: "revision", state: "accepted", startSnapshotDigest: `sha256:${"a".repeat(64)}`, quoteId: "quote", quotedAmount: "0.40", currency: "USD", acceptedAt: now.toISOString(), scheduleAuthority: { principalId: "user", keyId: "key", authorizationEvidenceRef: "evidence" } },
};

describe("Product campaign runtime worker", () => {
  it("materializes a bounded horizon, runs daily replenishment, then dispatches due work", async () => {
    const scheduleStore = { schedule: vi.fn().mockResolvedValue({ inserted: 3, replayed: 1 }), markStaleSubmissionsUnknown: vi.fn().mockResolvedValue(1), reconcileWorkflowRuns: vi.fn().mockResolvedValue(2) };
    const scheduler = { processDue: vi.fn().mockResolvedValue({ claimed: 2, started: 1, denied: 1, outcomeUnknown: 0 }) };
    const replenisher = { replenish: vi.fn().mockResolvedValue({ kind: "completed", created: 2, replayed: 0, stopReason: "run_limit_reached" }) };
    const campaignPage = vi.fn().mockResolvedValue([{ workspaceId: "ws", id: "campaign", kind: "campaign_automation", title: "Campaign", state: "active", revision: 4, payload, createdByUserId: "user", updatedByUserId: "user", createdAt: now, updatedAt: now, archivedAt: null }]);
    const worker = new ProductCampaignRuntimeWorker(scheduleStore as never, scheduler as never, replenisher as never, () => now, campaignPage);
    await expect(worker.run({ workerId: "worker" })).resolves.toMatchObject({ scanned: 1, scheduled: 3, scheduleReplayed: 1, replenished: 2, staleUnknown: 1, reconciled: 2, occurrences: { started: 1 } });
    expect(scheduleStore.schedule).toHaveBeenCalledWith("ws", expect.arrayContaining([expect.objectContaining({ campaignRevision: 4, timezone: "Asia/Riyadh", actor: payload.runtime.scheduleAuthority })]));
    expect(replenisher.replenish).toHaveBeenCalledWith(expect.objectContaining({ invocation: "daily", sourceKey: expect.stringContaining("campaign-blitz:daily:campaign:") }));
  });

  it("isolates an invalid campaign without blocking due occurrence recovery", async () => {
    const scheduleStore = { schedule: vi.fn(), markStaleSubmissionsUnknown: vi.fn().mockResolvedValue(0), reconcileWorkflowRuns: vi.fn().mockResolvedValue(0) };
    const scheduler = { processDue: vi.fn().mockResolvedValue({ claimed: 0, started: 0, denied: 0, outcomeUnknown: 0 }) };
    const campaignPage = vi.fn().mockResolvedValue([{ workspaceId: "ws", id: "bad", kind: "campaign_automation", state: "active", revision: 1, payload: {}, updatedByUserId: "user" }]);
    const worker = new ProductCampaignRuntimeWorker(scheduleStore as never, scheduler as never, { replenish: vi.fn() } as never, () => now, campaignPage as never);
    await expect(worker.run({ workerId: "worker" })).resolves.toMatchObject({ campaignFailures: 1, occurrences: { claimed: 0 } });
    expect(scheduler.processDue).toHaveBeenCalledOnce();
  });
});
