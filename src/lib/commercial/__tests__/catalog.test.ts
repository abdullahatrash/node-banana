import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { DEFAULT_BILLING_PLANS, DEFAULT_CREDIT_PACKS } from "../catalog";

describe("default commercial catalog", () => {
  it("publishes the approved four versioned plans", () => {
    expect(DEFAULT_BILLING_PLANS.map((plan) => ({
      id: plan.planId,
      version: plan.version,
      priceMinor: plan.priceMinor,
      credits: plan.entitlements.generationCreditsPerPeriod,
    }))).toEqual([
      { id: "free", version: 1, priceMinor: 0, credits: 10 },
      { id: "starter", version: 1, priceMinor: 2_900, credits: 250 },
      { id: "growth", version: 1, priceMinor: 4_900, credits: 500 },
      { id: "pro", version: 1, priceMinor: 14_900, credits: 2_000 },
    ]);
  });

  it("keeps every authored term bilingual and every immutable version digest-bound", () => {
    for (const item of [...DEFAULT_BILLING_PLANS, ...DEFAULT_CREDIT_PACKS]) {
      expect(item.authoredName.ar).not.toBe("");
      expect(item.authoredName.en).not.toBe("");
      expect(item.termsDigest).toMatch(/^sha256:[a-f0-9]{64}$/);
    }

    for (const plan of DEFAULT_BILLING_PLANS) {
      const terms = [
        `tasmeemai-plan/${plan.planId}/v${plan.version}`,
        plan.currency,
        plan.priceMinor,
        plan.billingInterval,
        plan.taxMode,
        plan.trialDays,
        plan.trialCreditUnits,
        plan.entitlements.generationCreditsPerPeriod,
        plan.entitlements.workspaceSeats,
        plan.entitlements.connectedChannels,
        plan.entitlements.activeAutomations,
        plan.entitlements.apiAccess,
        plan.entitlements.creatorPersonas,
        plan.entitlements.managedChannelOnboarding,
      ].join("|");
      expect(plan.termsDigest).toBe(`sha256:${createHash("sha256").update(terms).digest("hex")}`);
    }

    for (const pack of DEFAULT_CREDIT_PACKS) {
      const terms = [
        `tasmeemai-credit-pack/${pack.packId}/v${pack.version}`,
        pack.currency,
        pack.creditUnits,
        pack.priceMinor,
        pack.taxMinor,
      ].join("|");
      expect(pack.termsDigest).toBe(`sha256:${createHash("sha256").update(terms).digest("hex")}`);
    }
  });

  it("seeds plans and packs idempotently and fails closed on version conflicts", () => {
    const sql = readFileSync("drizzle/0116_default_commercial_catalog.sql", "utf8");
    expect(sql).toContain('ON CONFLICT ("plan_id", "version") DO NOTHING');
    expect(sql).toContain('ON CONFLICT ("pack_id", "version") DO NOTHING');
    expect(sql).toContain("default billing plan v1 catalog conflicts");
    expect(sql).toContain("default Generation Credit pack v1 catalog conflicts");
    for (const plan of DEFAULT_BILLING_PLANS) {
      expect(sql).toContain(`'${plan.planId}'`);
      expect(sql).toContain(plan.termsDigest);
    }
    for (const pack of DEFAULT_CREDIT_PACKS) {
      expect(sql).toContain(`'${pack.packId}'`);
      expect(sql).toContain(pack.termsDigest);
    }
  });
});
