import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { I18nTestProvider } from "@/test/i18n";
import { WorkspaceChannelsSettings } from "../WorkspaceChannelsSettings";

const summary = {
  entitlement: { planId: "starter", planVersion: 1, subscriptionState: "trialing", authoredName: { ar: "البداية", en: "Starter" }, connectedChannels: 5 },
  usage: { active: 2, healthy: 1, requiresReauth: 1, disabled: 1, remaining: 3 },
  providers: [
    { identifier: "instagram", displayName: "Instagram", configured: true, connected: 2, supportsImages: true, supportsVideo: true, supportsCarousel: true, supportsPostMetrics: true },
    { identifier: "x", displayName: "X", configured: false, connected: 0, supportsImages: true, supportsVideo: true, supportsCarousel: false, supportsPostMetrics: false },
  ],
  measuredAt: "2026-09-04T12:00:00.000Z",
};

describe("WorkspaceChannelsSettings", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ success: true, data: summary }), { status: 200, headers: { "content-type": "application/json" } })));
  });
  afterEach(() => vi.unstubAllGlobals());

  it("renders the purchased allowance and canonical management paths", async () => {
    render(<I18nTestProvider locale="en"><WorkspaceChannelsSettings workspaceId="workspace-1" canConnect /></I18nTestProvider>);
    expect(await screen.findByRole("heading", { name: "Publishing Channels" })).toBeInTheDocument();
    await waitFor(() => expect(fetch).toHaveBeenCalledWith("/api/social/channels/summary", { headers: { "x-workspace-id": "workspace-1" }, cache: "no-store" }));
    expect(screen.getByRole("progressbar", { name: "Connected Channel allowance" })).toHaveAttribute("aria-valuenow", "2");
    expect(screen.getByText("Starter · v1")).toBeInTheDocument();
    expect(screen.getByText("Needs server setup")).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: "Manage Channels" })[0]).toHaveAttribute("href", "/channels");
    expect(screen.getByRole("link", { name: "Managed onboarding" })).toHaveAttribute("href", "/channels/onboarding");
  });

  it("renders authored Arabic provider and safety guidance in RTL", async () => {
    const { container } = render(<I18nTestProvider locale="ar"><WorkspaceChannelsSettings workspaceId="workspace-1" canConnect={false} /></I18nTestProvider>);
    expect(await screen.findByRole("heading", { name: "قنوات النشر" })).toBeInTheDocument();
    expect(container.firstElementChild).toHaveAttribute("dir", "rtl");
    expect(screen.getByRole("heading", { name: "إنستغرام" })).toBeInTheDocument();
    expect(screen.getByText(/كلمة مرور المنصة/)).toBeInTheDocument();
  });
});
