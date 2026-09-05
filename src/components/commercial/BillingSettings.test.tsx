import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { I18nTestProvider } from "@/test/i18n";
import { BillingSettings } from "./BillingSettings";

const freeEntitlements = { generationCreditsPerPeriod: 10, workspaceSeats: 1, connectedChannels: 2, activeAutomations: 0, apiAccess: false, creatorPersonas: false, managedChannelOnboarding: false };
const starterEntitlements = { generationCreditsPerPeriod: 250, workspaceSeats: 3, connectedChannels: 5, activeAutomations: 3, apiAccess: false, creatorPersonas: false, managedChannelOnboarding: false };

const summary = {
  subscription: null,
  plans: [
    { planId: "free", version: 1, authoredName: { ar: "مجانية", en: "Free" }, currency: "USD", priceMinor: 0, billingInterval: "month", trialDays: 0, trialCreditUnits: 0, entitlements: freeEntitlements },
    { planId: "starter", version: 1, authoredName: { ar: "البداية", en: "Starter" }, currency: "USD", priceMinor: 2_900, billingInterval: "month", trialDays: 7, trialCreditUnits: 25, entitlements: starterEntitlements },
  ],
  creditPacks: [],
  quotes: [],
  credit: { availableUnits: 10, liabilityUnits: 0, buckets: [], heldReservations: [], recentEntries: [] },
  financials: { transactions: [], adjustments: [], executionHolds: [] },
  referrals: { codes: [], rewards: [], payoutEntries: [] },
};

const withSubscription = (subscription: NonNullable<typeof summary["subscription"]> | Record<string, unknown>) => ({
  ...summary,
  subscription,
});

const readyGeneration = {
  schema: "generation-readiness/v1" as const,
  qualifiedModelCount: 2,
  qualifiedCapabilities: ["text_to_image", "text_to_video"],
  gates: {
    acceptedBrand: true,
    canonicalMediaStorage: true,
    processingRegion: true,
    byokCredential: false,
    managedCredential: true,
    managedCreditRate: true,
  },
};

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
        authoredName: { ar: "مجانية", en: "Free" },
        entitlements: freeEntitlements,
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
        authoredName: { ar: "البداية", en: "Starter" },
        entitlements: starterEntitlements,
        currentPeriodEndsAt: "2026-09-11T00:00:00.000Z",
        graceEndsAt: null,
        merchantCustomerRef: null,
        merchantSubscriptionRef: null,
      }),
    }), { status: 200, headers: { "content-type": "application/json" } })));

    render(<I18nTestProvider locale="en"><BillingSettings workspaceId="workspace-1" canManage canPurchase /></I18nTestProvider>);

    expect(await screen.findByText("Trial")).toBeInTheDocument();
    expect(screen.getByText("Starter")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Current plan allowances" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Subscribe securely" })).not.toBeInTheDocument();
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

  it("shows an outstanding refund clawback and does not present it as available credit", async () => {
    const evidence = { ...summary, credit: { ...summary.credit, availableUnits: 4, liabilityUnits: 6 } };
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ success: true, data: evidence }), { status: 200, headers: { "content-type": "application/json" } })));
    render(<I18nTestProvider locale="en"><BillingSettings workspaceId="workspace-1" canManage canPurchase /></I18nTestProvider>);
    expect(await screen.findByRole("alert")).toHaveTextContent("6 refunded or disputed credits were already consumed");
    expect(screen.getByText("4")).toBeInTheDocument();
  });

  it.each([
    ["en" as const, "Managed generation is paused for this billing period because its payment was disputed. Use the billing portal or contact support to resolve it."],
    ["ar" as const, "توقف التوليد المُدار لهذه الفترة لأن دفعتها متنازع عليها. استخدم بوابة الفوترة أو تواصل مع الدعم لتسويتها."],
  ])("warns in %s when the current subscription period has an active financial hold", async (locale, message) => {
    const evidence = {
      ...summary,
      subscription: {
        state: "active",
        planId: "starter",
        planVersion: 1,
        authoredName: { ar: "البداية", en: "Starter" },
        entitlements: starterEntitlements,
        currentPeriodStartsAt: "2026-09-01T00:00:00.000Z",
        currentPeriodEndsAt: "2026-10-01T00:00:00.000Z",
        graceEndsAt: null,
        merchantCustomerRef: "ctm_1",
        merchantSubscriptionRef: "sub_1",
      },
      financials: {
        ...summary.financials,
        executionHolds: [{
          provider: "paddle",
          transactionRef: "txn_1",
          merchantSubscriptionRef: "sub_1",
          reason: "disputed",
          state: "active",
          periodStartsAt: "2026-09-01T00:00:00.000Z",
          periodEndsAt: "2026-10-01T00:00:00.000Z",
        }],
      },
    };
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ success: true, data: evidence }), { status: 200, headers: { "content-type": "application/json" } })));

    const { container } = render(<I18nTestProvider locale={locale}><BillingSettings workspaceId="workspace-1" canManage canPurchase /></I18nTestProvider>);

    expect(await screen.findByText(message)).toHaveAttribute("role", "alert");
    expect(container.firstElementChild).toHaveAttribute("dir", locale === "ar" ? "rtl" : "ltr");
  });

  it("keeps credits visible while explaining every missing managed-generation gate", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).endsWith("/api/studio/model-routing/catalog")) {
        return new Response(JSON.stringify({
          success: true,
          generationReadiness: {
            ...readyGeneration,
            qualifiedModelCount: 0,
            qualifiedCapabilities: [],
            gates: {
              ...readyGeneration.gates,
              processingRegion: false,
              managedCredential: false,
            },
          },
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
      return new Response(JSON.stringify({ success: true, data: summary }), { status: 200, headers: { "content-type": "application/json" } });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<I18nTestProvider locale="en"><BillingSettings workspaceId="workspace-1" canManage canPurchase /></I18nTestProvider>);

    expect(await screen.findByRole("heading", { name: "Your credits are available, but managed AI setup is incomplete" })).toBeInTheDocument();
    expect(screen.getAllByText("10").length).toBeGreaterThan(0);
    expect(screen.getByText("Qualify a compatible Replicate model")).toBeInTheDocument();
    expect(screen.getByText("Verify the Replicate processing region")).toBeInTheDocument();
    expect(screen.getByText("Enable the managed Replicate account")).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: "Model routing" })[0]).toHaveAttribute("href", "/studio/model-routing");
  });

  it("renders an authored Arabic ready state without requiring a workspace BYOK key", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).endsWith("/api/studio/model-routing/catalog")) {
        return new Response(JSON.stringify({ success: true, generationReadiness: readyGeneration }), { status: 200, headers: { "content-type": "application/json" } });
      }
      return new Response(JSON.stringify({ success: true, data: summary }), { status: 200, headers: { "content-type": "application/json" } });
    }));

    const { container } = render(<I18nTestProvider locale="ar"><BillingSettings workspaceId="workspace-1" canManage canPurchase /></I18nTestProvider>);

    expect(await screen.findByRole("heading", { name: "التوليد المُدار بالذكاء الاصطناعي جاهز" })).toBeInTheDocument();
    expect(screen.getByText("يتوفر حاليًا 2 من إمكانات التوليد المعتمدة.")).toBeInTheDocument();
    expect(screen.queryByText("حفظ مفتاح Replicate متحقق منه")).not.toBeInTheDocument();
    expect(container.firstElementChild).toHaveAttribute("dir", "rtl");
  });
});
