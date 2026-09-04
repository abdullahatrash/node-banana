import { describe, expect, it, vi } from "vitest";
import { CampaignOccurrenceScheduler, campaignScheduleSnapshots, type CampaignSchedulerRepository, type ClaimedCampaignOccurrence } from "../campaign-scheduler";

const at = new Date("2026-09-06T00:00:00Z");
const occurrence = (): ClaimedCampaignOccurrence => ({ workspaceId: "ws", id: "occ", leaseToken: "lease", campaignId: "campaign", campaignRevision: 3, campaignDigest: `sha256:${"a".repeat(64)}`, scheduledAt: at, occurrenceKey: "campaign-occurrence:key", format: "slideshow", timezone: "Asia/Riyadh", channels: ["channel"], approvalMode: "request_human", autoPublishGrantId: null, fundingMode: "managed", budgetCeilingCents: 50, creditCeiling: 5, workflow: { workflowId: "workflow", workflowRevisionId: "revision", inputs: {}, inputArtifactIds: [] }, actor: { principalId: "user", keyId: "key", authorizationEvidenceRef: "evidence" } });
const repository = (claimed: ClaimedCampaignOccurrence[]) => ({ schedule: vi.fn(), cancelFuture: vi.fn(), claimDue: vi.fn().mockResolvedValue(claimed), markSubmitting: vi.fn().mockResolvedValue(true), bindRun: vi.fn(), fail: vi.fn() }) satisfies CampaignSchedulerRepository;
const preview = (amount: string) => ({ admissible: true, denialReasons: [], ceiling: { amount, currency: "USD", certainty: "conservative" }, stepExposures: [{ provider: "replicate", model: "m", amountPerAttempt: amount, automaticAttempts: 1, pricingSnapshotIds: ["price"] }] });

describe("Campaign Occurrence scheduler", () => {
  it("pins the immutable campaign revision and execution authority into every plan", () => {
    const rows = campaignScheduleSnapshots({ workspaceId: "ws", campaign: { id: "campaign", revision: 3, state: "active", payload: { currentStep: 10, name: "Campaign", formatMix: { slideshow: 100 }, remixRatio: 0, inspirationIds: [], contentLanguage: "ar", arabicVariety: "msa", personaIds: [], mediaSetIds: [], channelIds: ["channel"], variantsPerChannel: 1, cadence: { timezone: "Asia/Riyadh", weekStart: 0, startAt: null, endAt: null, postsPerWeek: 1 }, execution: { mode: "managed", modelPolicy: "policy", creditCeiling: 5, budgetCents: 50, workflow: { workflowId: "workflow", workflowRevisionId: "revision", inputs: {}, inputArtifactIds: [] } }, reviewMode: "request_human", autoPublishGrantId: null, validationErrors: [], runtime: null } }, actor: occurrence().actor, from: at, through: new Date(at.getTime() + 8 * 86_400_000) });
    expect(rows.length).toBeGreaterThan(0); expect(rows[0]).toMatchObject({ campaignRevision: 3, approvalMode: "request_human", channels: ["channel"], workflow: { workflowRevisionId: "revision" } });
  });

  it("launches the exact scheduled key through quote admission", async () => {
    const repo = repository([occurrence()]); const runtime = { preview: vi.fn().mockResolvedValue(preview("0.40")), start: vi.fn().mockResolvedValue({ run: { id: "run", workflowId: "workflow", workflowRevisionId: "revision", state: "accepted", startSnapshotDigest: `sha256:${"b".repeat(64)}`, acceptedAt: at.toISOString() } }) };
    const scheduler = new CampaignOccurrenceScheduler(repo, runtime as never, { seal: () => "signed" }, () => at);
    await expect(scheduler.processDue({ workerId: "worker" })).resolves.toMatchObject({ started: 1, denied: 0 });
    expect(repo.markSubmitting).toHaveBeenCalledWith(expect.objectContaining({ occurrence: expect.objectContaining({ id: "occ" }) }));
    expect(runtime.start).toHaveBeenCalledWith(expect.objectContaining({ idempotencyKey: "campaign-occurrence:key", acceptedSpendQuoteRef: "signed" }));
    expect(repo.bindRun).toHaveBeenCalledWith(expect.objectContaining({ runId: "run" }));
  });

  it("fails closed before starting work above the campaign ceiling", async () => {
    const repo = repository([occurrence()]); const runtime = { preview: vi.fn().mockResolvedValue(preview("0.51")), start: vi.fn() };
    const scheduler = new CampaignOccurrenceScheduler(repo, runtime as never, { seal: () => "signed" }, () => at);
    await expect(scheduler.processDue({ workerId: "worker" })).resolves.toMatchObject({ denied: 1, started: 0 });
    expect(runtime.start).not.toHaveBeenCalled(); expect(repo.fail).toHaveBeenCalledWith(expect.objectContaining({ code: "CAMPAIGN_OCCURRENCE_BUDGET_DENIED", outcomeUnknown: false }));
  });

  it("records only post-claim provider ambiguity as outcome unknown", async () => {
    const repo = repository([occurrence()]); const runtime = { preview: vi.fn().mockResolvedValue(preview("0.40")), start: vi.fn().mockRejectedValue(new Error("transport_lost")) };
    const scheduler = new CampaignOccurrenceScheduler(repo, runtime as never, { seal: () => "signed" }, () => at);
    await expect(scheduler.processDue({ workerId: "worker" })).resolves.toMatchObject({ outcomeUnknown: 1, denied: 0 });
    expect(repo.fail).toHaveBeenCalledWith(expect.objectContaining({ code: "transport_lost", outcomeUnknown: true }));
  });
});
