import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { I18nTestProvider } from "@/test/i18n";
import { ServiceStatusBanner } from "./ServiceStatusBanner";

describe("ServiceStatusBanner", () => {
  afterEach(() => vi.unstubAllGlobals());
  it("stays quiet when the operator has not configured a public status workspace", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ configured: false, status: "unknown", incidents: [] }), { status: 200 })));
    render(<I18nTestProvider locale="en"><ServiceStatusBanner /></I18nTestProvider>);
    await vi.waitFor(() => expect(fetch).toHaveBeenCalled());
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });
  it("stays quiet while operational and links a localized degraded state", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ configured: true, status: "degraded", incidents: [{ summary: "Video generation delayed" }] }), { status: 200 })));
    render(<I18nTestProvider locale="en"><ServiceStatusBanner /></I18nTestProvider>);
    expect(await screen.findByRole("link", { name: /Some services are degraded/ })).toHaveAttribute("href", "/en/status");
  });
  it("renders critical outages without collapsing their severity", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ configured: true, status: "criticalOutage", incidents: [{ summary: "Publishing outcome unknown" }] }), { status: 200 })));
    render(<I18nTestProvider locale="en"><ServiceStatusBanner /></I18nTestProvider>);
    expect(await screen.findByRole("link", { name: /Critical service outage/ })).toHaveAttribute("href", "/en/status");
  });
});
