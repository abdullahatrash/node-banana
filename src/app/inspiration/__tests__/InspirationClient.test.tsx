import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { I18nTestProvider } from "@/test/i18n";
import { InspirationClient, type InspirationDiscoveryItem } from "../InspirationClient";

const mocks = vi.hoisted(() => ({ request: vi.fn(), refresh: vi.fn(), push: vi.fn() }));
vi.mock("@/components/product-surfaces/ProductApi", () => ({ productRequest: (...args: unknown[]) => mocks.request(...args) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mocks.refresh, push: mocks.push }) }));

const trend: InspirationDiscoveryItem = {
  id: "trend-1", title: "إطلاق متجر خليجي", revision: 2, state: "active", score: 9_200,
  freshness: "live", metricsObservedAt: "2026-09-04T11:00:00.000Z", sourcePublishedAt: "2026-09-04T09:00:00.000Z",
  eligibleForBlitz: false, origin: "trend",
  payload: {
    sourceUrl: "https://example.com/trend", sourceName: "MENA Trends", region: "GCC", contentLanguage: "ar", arabicVariety: "gulf", format: "video_hook_demo",
    rightsStatus: "metadata_only", sourceAssetId: null, sourceMediaType: null, rightsSnapshot: null,
    metrics: { views: 150_000, likes: 12_000 }, tags: ["commerce"], whyThisAppears: ["fresh_metrics", "mena_region_match", "metadata_only_rights"],
  },
};
const performanceSource = { id: "post-1:asset-1", postId: "post-1", title: "Our winning reel", sourceUrl: "https://social.example/posts/1", publishedAt: "2026-09-04T10:00:00.000Z", sourceAssetId: "asset-1", rightsSnapshot: { id: "rights-1", revision: 1, digest: `sha256:${"a".repeat(64)}` as const }, channel: "Brand · instagram", socialAccountId: "account-1", platform: "instagram", verifiedSyncSupported: true, requiresReauth: false, sync: null };

function renderClient(locale: "en" | "ar" = "en") {
  return render(<I18nTestProvider locale={locale}><InspirationClient items={[trend]} /></I18nTestProvider>);
}

describe("Inspiration trend discovery", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.request.mockResolvedValue({ success: true, result: { scheduled: 1 } });
  });

  it("shows explainable score, freshness, localized reasons, and a rights-gated Blitz action", () => {
    renderClient();
    expect(screen.getByText("Fit 92/100")).toBeInTheDocument();
    expect(screen.getByText("Live · under 24h")).toBeInTheDocument();
    expect(screen.getByText("Preferred MENA market")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add to Blitz Queue" })).toBeDisabled();
    expect(screen.getByText(/needs an admissible Workspace Asset/)).toBeInTheDocument();
  });

  it("filters the discovery feed without mutating durable records", () => {
    renderClient();
    fireEvent.change(screen.getByPlaceholderText("Search topics, sources, and tags"), { target: { value: "missing" } });
    expect(screen.queryByText("إطلاق متجر خليجي")).not.toBeInTheDocument();
    expect(screen.getByText("No inspiration matches these filters.")).toBeInTheDocument();
  });

  it("queues an idempotent source refresh and renders Arabic discovery keys", async () => {
    renderClient("ar");
    fireEvent.click(screen.getByRole("button", { name: "تحديث المصادر" }));
    await waitFor(() => expect(mocks.request).toHaveBeenCalledWith("/api/product-inspiration", expect.objectContaining({ action: "refresh", idempotencyKey: expect.any(String) })));
    expect(await screen.findByText("تمت جدولة 1 من المصادر للإثراء.")).toBeInTheDocument();
    expect(screen.getByText("سوق مفضلة في المنطقة")).toBeInTheDocument();
  });

  it("records eligible Workspace-owned performance and queues its refresh", async () => {
    render(<I18nTestProvider locale="en"><InspirationClient items={[trend]} performanceSources={[performanceSource]} /></I18nTestProvider>);
    fireEvent.change(screen.getByLabelText("Published Workspace video", { selector: "select[name=performanceSource]" }), { target: { value: performanceSource.id } });
    fireEvent.change(screen.getByLabelText("Analytics source or export reference"), { target: { value: "platform-dashboard:2026-09-04" } });
    fireEvent.change(screen.getByLabelText("Metrics observed at"), { target: { value: "2026-09-04T12:00" } });
    fireEvent.change(screen.getByLabelText("Views"), { target: { value: "12000" } });
    fireEvent.change(screen.getByLabelText("Likes"), { target: { value: "900" } });
    fireEvent.change(screen.getByLabelText("Market or region", { selector: "input[name=performanceRegion]" }), { target: { value: "GCC" } });
    fireEvent.click(screen.getByRole("button", { name: "Record and refresh" }));
    await waitFor(() => expect(mocks.request).toHaveBeenNthCalledWith(1, "/api/product-inspiration/performance", expect.objectContaining({ postId: "post-1", sourceAssetId: "asset-1", metrics: { views: 12000, likes: 900, comments: 0 }, contentLanguage: "ar", arabicVariety: null })));
    expect(mocks.request).toHaveBeenNthCalledWith(2, "/api/product-inspiration", expect.objectContaining({ action: "refresh" }));
  });

  it("configures provider-verified sync without asking the user for metric counts", async () => {
    render(<I18nTestProvider locale="en"><InspirationClient items={[trend]} performanceSources={[performanceSource]} /></I18nTestProvider>);
    fireEvent.change(screen.getByLabelText("Published Workspace video", { selector: "select[name=syncSource]" }), { target: { value: performanceSource.id } });
    fireEvent.change(screen.getByLabelText("Market or region", { selector: "input[name=syncRegion]" }), { target: { value: "GCC" } });
    fireEvent.click(screen.getByRole("button", { name: "Enable verified sync" }));
    await waitFor(() => expect(mocks.request).toHaveBeenCalledWith("/api/product-inspiration/performance/syncs", expect.objectContaining({ action: "enable", postId: "post-1", sourceAssetId: "asset-1", scheduleMinutes: 60, region: "GCC", contentLanguage: "ar" })));
    expect(screen.getByText(/first run is queued/)).toBeInTheDocument();
  });
});
