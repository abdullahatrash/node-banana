import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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
  financials: { transactions: [], adjustments: [] },
  referrals: { codes: [], rewards: [], payoutEntries: [] },
};

const withSubscription = (subscription: NonNullable<typeof summary["subscription"]> | Record<string, unknown>) => ({
  ...summary,
  subscription,
});

describe("BillingSettings default plan", () => {
  afterEach(() => vi.unstubAllGlobals());

  it.each([
    ["en" as const, "Current free plan"],
    ["ar" as const, "الباقة المجانية الحالية"],
  ])("does not offer an impossible zero-dollar checkout in %s", async (locale, currentLabel) => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ success: true, data: summary }), { status: 200, headers: { "content-type": "application/json" } })));
    const { container } = render(<I18nTestProvider locale={locale}><BillingSettings workspaceId="workspace-1" canManage canPurchase /></I18nTestProvider>);
    expect(await screen.findByText(currentLabel)).toBeInTheDocument();
    expect(screen.getByText(locale === "ar" ? "البداية" : "Starter")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: locale === "ar" ? "الاشتراك بأمان" : "Subscribe securely" })).toHaveLength(1);
    expect(container.firstElementChild).toHaveAttribute("dir", locale === "ar" ? "rtl" : "ltr");
  });

  it("keeps upgrade plans visible for a provisioned Free subscription", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      success: true,
      data: withSubscription({
        state: "active",
        planId: "free",
        planVersion: 1,
        currentPeriodEndsAt: "2026-10-04T00:00:00.000Z",
        graceEndsAt: null,
        merchantCustomerRef: null,
        merchantSubscriptionRef: null,
      }),
    }), { status: 200, headers: { "content-type": "application/json" } })));

    render(<I18nTestProvider locale="en"><BillingSettings workspaceId="workspace-1" canManage canPurchase /></I18nTestProvider>);

    expect(await screen.findByText("Starter")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Start trial" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Open billing portal" })).not.toBeInTheDocument();
  });

  it("does not offer unsupported plan switching or a portal during a local trial", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      success: true,
      data: withSubscription({
        state: "trialing",
        planId: "starter",
        planVersion: 1,
        currentPeriodEndsAt: "2026-09-11T00:00:00.000Z",
        graceEndsAt: null,
        merchantCustomerRef: null,
        merchantSubscriptionRef: null,
      }),
    }), { status: 200, headers: { "content-type": "application/json" } })));

    render(<I18nTestProvider locale="en"><BillingSettings workspaceId="workspace-1" canManage canPurchase /></I18nTestProvider>);

    expect(await screen.findByText("Trial")).toBeInTheDocument();
    expect(screen.queryByText("Starter")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Open billing portal" })).not.toBeInTheDocument();
  });

  it("shows workspace-scoped credit history and accepts an active exact quote", async () => {
    const evidence = {
      ...summary,
      quotes: [{ id: "quote-1", state: "offered", purposeRef: "generation:video-1", maxCreditDebit: 14, currency: "USD", localPriceMinor: 700, taxMinor: 100, expiresAt: "2026-09-05T10:00:00.000Z" }],
      credit: {
        ...summary.credit,
        recentEntries: [{ id: "entry-1", entryType: "reserve", deltaUnits: -14, balanceAfterUnits: 96, createdAt: "2026-09-04T10:00:00.000Z" }],
      },
    };
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => new Response(JSON.stringify(init?.method === "POST" ? { success: true, result: { state: "accepted" } } : { success: true, data: evidence }), { status: 200, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);

    render(<I18nTestProvider locale="en"><BillingSettings workspaceId="workspace-server" canManage canPurchase /></I18nTestProvider>);

    expect(await screen.findByText("Execution reservation")).toBeInTheDocument();
    expect(screen.getByText("-14")).toBeInTheDocument();
    expect(screen.getByText("Up to 14 Generation Credits")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Accept exact quote" }));
    expect(fetchMock).toHaveBeenCalledWith("/api/studio/billing", expect.objectContaining({
      method: "POST",
      headers: expect.objectContaining({ "x-workspace-id": "workspace-server" }),
    }));
  });
});
