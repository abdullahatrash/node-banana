import { describe, expect, it } from "vitest";
import { planBlitzReplenishment, type BlitzReplenishmentSource } from "../blitz-replenishment-policy";

const now = new Date("2026-09-04T00:00:00Z");
const source = (id: string, overrides: Partial<BlitzReplenishmentSource> = {}): BlitzReplenishmentSource => ({ id, format: "slideshow", contentLanguage: "ar", rightsAdmitted: true, observedAt: now, views: 100, likes: 10, ...overrides });
const policy = { mode: "daily" as const, targetCapacity: 5, maximumCreatesPerRun: 3, prospectiveSpendCeilingCents: 100, perProposalGenerationCeilingCents: 20, remixRatio: 100, executionMode: "managed" as const, contentLanguage: "ar" as const, formatMix: { slideshow: 60, wall_of_text: 40 } };

describe("bounded Blitz replenishment", () => {
  it("stops at queue, run, and prospective spend bounds without generating", () => {
    const result = planBlitzReplenishment({ policy, invocation: "daily", sources: [source("a"), source("b"), source("c"), source("d")], queuedCount: 3, existingSourceIds: new Set(), prospectiveCommittedCents: 40, now });
    expect(result.selected.map((item) => item.id)).toEqual(["a", "b"]);
  });

  it("filters wrong language, rights, format, and already queued sources", () => {
    const result = planBlitzReplenishment({ policy, invocation: "manual", sources: [source("existing"), source("en", { contentLanguage: "en" }), source("rights", { rightsAdmitted: false }), source("format", { format: "custom_upload" }), source("ok")], queuedCount: 0, existingSourceIds: new Set(["existing"]), prospectiveCommittedCents: 0, now });
    expect(result.selected.map((item) => item.id)).toEqual(["ok"]);
  });

  it("stops before admitting prospective work beyond the ceiling", () => {
    expect(planBlitzReplenishment({ policy, invocation: "daily", sources: [source("a")], queuedCount: 0, existingSourceIds: new Set(), prospectiveCommittedCents: 100, now })).toMatchObject({ selected: [], stopReason: "spend_ceiling_reached" });
  });
});
