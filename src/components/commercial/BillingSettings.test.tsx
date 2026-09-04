import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { I18nTestProvider } from "@/test/i18n";
import { BillingSettings } from "./BillingSettings";

const summary = {
  subscription: null,
  plans: [
    { planId: "free", version: 1, authoredName: { ar: "مجانية", en: "Free" }, currency: "USD", priceMinor: 0, billingInterval: "month", trialDays: 0, trialCreditUnits: 0, entitlements: {} },
    { planId: "starter", version: 1, authoredName: { ar: "البداية", en: "Starter" }, currency: "USD", priceMinor: 2_900, billingInterval: "month", trialDays: 7, trialCreditUnits: 25, entitlements: {} },
  ],
  creditPacks: [],
  quotes: [],
  credit: { availableUnits: 10, buckets: [], heldReservations: [], recentEntries: [] },
  referrals: { codes: [], rewards: [], payoutEntries: [] },
};

describe("BillingSettings default plan", () => {
  afterEach(() => vi.unstubAllGlobals());

  it.each([
    ["en" as const, "Current free plan"],
    ["ar" as const, "الباقة المجانية الحالية"],
  ])("does not offer an impossible zero-dollar checkout in %s", async (locale, currentLabel) => {
    window.localStorage.setItem("node-banana-active-workspace-id", "workspace-1");
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ success: true, data: summary }), { status: 200, headers: { "content-type": "application/json" } })));
    render(<I18nTestProvider locale={locale}><BillingSettings canManage canPurchase /></I18nTestProvider>);
    expect(await screen.findByText(currentLabel)).toBeInTheDocument();
    expect(screen.getByText(locale === "ar" ? "البداية" : "Starter")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: locale === "ar" ? "الاشتراك بأمان" : "Subscribe securely" })).toHaveLength(1);
  });
});
