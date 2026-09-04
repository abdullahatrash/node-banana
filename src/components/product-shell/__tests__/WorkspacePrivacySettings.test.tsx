import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { I18nTestProvider } from "@/test/i18n";
import { WorkspacePrivacySettings } from "../WorkspacePrivacySettings";

const consent = { schema: "product-telemetry-consent/v1", workspaceId: "workspace-1", userId: "user-1", revision: 4, purpose: "product_analytics", status: "active", issuedAt: "2026-09-04T12:00:00.000Z", expiresAt: "2026-12-03T12:00:00.000Z" };

describe("WorkspacePrivacySettings", () => {
  beforeEach(() => { vi.useFakeTimers({ shouldAdvanceTime: true }); vi.setSystemTime(new Date("2026-09-04T12:00:00.000Z")); });
  afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

  it("enables personal product analytics consent without enabling advertising", async () => {
    let current: typeof consent | null = null;
    vi.stubGlobal("crypto", { randomUUID: () => "privacy-idempotency-123" });
    vi.stubGlobal("fetch", vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "POST") current = consent;
      return new Response(JSON.stringify({ success: true, consent: current }), { status: init?.method === "POST" ? 201 : 200, headers: { "content-type": "application/json" } });
    }));
    render(<I18nTestProvider locale="en"><WorkspacePrivacySettings workspaceId="workspace-1" /></I18nTestProvider>);
    expect(await screen.findByText("Inactive")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Enable product analytics" }));
    await waitFor(() => expect(fetch).toHaveBeenCalledWith("/api/studio/product-telemetry/consent", expect.objectContaining({ method: "POST", headers: expect.objectContaining({ "idempotency-key": "privacy-idempotency-123", "x-workspace-id": "workspace-1" }) })));
    const post = vi.mocked(fetch).mock.calls.find(([, init]) => init?.method === "POST")?.[1];
    const body = JSON.parse(String(post?.body)) as { status: string; expiresAt: string };
    expect(body.status).toBe("active");
    expect(Math.abs(new Date(body.expiresAt).getTime() - Date.now() - 90 * 86_400_000)).toBeLessThan(1_000);
    expect(screen.getByText("X Ads attribution")).toBeInTheDocument();
    expect(screen.getByText(/No X Pixel or Conversion API integration is loaded/)).toBeInTheDocument();
  });

  it("renders authored Arabic RTL copy while isolating advertising consent", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ success: true, consent }), { status: 200, headers: { "content-type": "application/json" } })));
    const { container } = render(<I18nTestProvider locale="ar"><WorkspacePrivacySettings workspaceId="workspace-1" /></I18nTestProvider>);
    expect(await screen.findByRole("heading", { name: "الخصوصية والموافقة" })).toBeInTheDocument();
    expect(container.firstElementChild).toHaveAttribute("dir", "rtl");
    expect(container.firstElementChild).toHaveAttribute("lang", "ar");
    expect(screen.getByText(/لا تُحمّل المنصة بكسل X/)).toBeInTheDocument();
  });
});
