import { describe, expect, it, vi } from "vitest";
import { BlitzReplenisher, type BlitzReplenishmentRepository } from "../blitz-replenisher";

const now = new Date("2026-09-04T00:00:00Z");
const run = { workspaceId: "ws", runId: "run", leaseToken: "lease", sourceKey: "daily:2026-09-04", invocation: "daily" as const, context: { policy: { mode: "daily" as const, targetCapacity: 3, maximumCreatesPerRun: 2, prospectiveSpendCeilingCents: 100, perProposalGenerationCeilingCents: 20, remixRatio: 100, executionMode: "managed" as const, contentLanguage: "ar" as const, formatMix: { slideshow: 100 } }, sources: [{ id: "source", format: "slideshow" as const, contentLanguage: "ar" as const, rightsAdmitted: true, observedAt: now, views: 100, likes: 10 }], queuedCount: 0, queuedRemixCount: 0, existingSourceIds: new Set<string>(), prospectiveCommittedCents: 0 } };

describe("Blitz replenisher", () => {
  it("claims and appends a bounded queue without any provider port", async () => {
    const repository = { claim: vi.fn().mockResolvedValue({ kind: "claimed", run }), append: vi.fn().mockResolvedValue({ created: 1, replayed: 0 }), complete: vi.fn(), fail: vi.fn() } satisfies BlitzReplenishmentRepository;
    await expect(new BlitzReplenisher(repository, () => now).replenish({ workspaceId: "ws", campaignId: "campaign", invocation: "daily", actorUserId: "user", sourceKey: "daily:2026-09-04" })).resolves.toMatchObject({ kind: "completed", created: 1 });
    expect(repository.append).toHaveBeenCalledWith(expect.objectContaining({ selected: [expect.objectContaining({ id: "source" })] }));
  });

  it("replays the durable result for the same source occurrence key", async () => {
    const repository = { claim: vi.fn().mockResolvedValue({ kind: "replayed", created: 2, stopReason: "run_limit_reached" }), append: vi.fn(), complete: vi.fn(), fail: vi.fn() } satisfies BlitzReplenishmentRepository;
    await expect(new BlitzReplenisher(repository, () => now).replenish({ workspaceId: "ws", campaignId: "campaign", invocation: "manual", actorUserId: "user", sourceKey: "manual:key" })).resolves.toMatchObject({ kind: "replayed", created: 2 });
    expect(repository.append).not.toHaveBeenCalled();
  });
});
