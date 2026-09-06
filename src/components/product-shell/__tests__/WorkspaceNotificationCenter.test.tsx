import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { I18nTestProvider } from "@/test/i18n";
import { WorkspaceNotificationCenter } from "../WorkspaceNotificationCenter";

describe("WorkspaceNotificationCenter", () => {
  afterEach(() => { vi.unstubAllGlobals(); window.localStorage.clear(); });

  it("renders authored Arabic financial evidence and marks only the current recipient read", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ success: true, notifications: [{ id: "evt_1", title: "نزاع فوترة يحتاج إلى تدخلك", body: "فُتح نزاع على المعاملة txn_1.", actionLabel: "فتح الفوترة", actionPath: "/billing", occurredAt: "2026-09-05T00:00:00.000Z", read: false, severity: "critical" }] }), { status: 200, headers: { "content-type": "application/json" } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ success: true, result: { eventId: "evt_1", read: true } }), { status: 200, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    render(<I18nTestProvider locale="ar"><WorkspaceNotificationCenter workspaceId="ws_1" authorizedWorkspaces={[{ id: "ws_1" }]} /></I18nTestProvider>);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/studio/notifications?limit=20", expect.objectContaining({ headers: { "x-workspace-id": "ws_1" } })));
    await userEvent.click(screen.getByLabelText("فتح الإشعارات"));
    expect(await screen.findByText("نزاع فوترة يحتاج إلى تدخلك")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "تحديد كمقروء" }));
    expect(fetchMock).toHaveBeenLastCalledWith("/api/studio/notifications/evt_1/read", expect.objectContaining({ method: "POST", headers: { "x-workspace-id": "ws_1" } }));
  });

  it("uses the authorized locally selected workspace", async () => {
    window.localStorage.setItem("node-banana-active-workspace-id", "ws_2");
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ success: true, notifications: [] }), { status: 200, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    render(<I18nTestProvider locale="en"><WorkspaceNotificationCenter workspaceId="ws_1" authorizedWorkspaces={[{ id: "ws_1" }, { id: "ws_2" }]} /></I18nTestProvider>);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/studio/notifications?limit=20", expect.objectContaining({ headers: { "x-workspace-id": "ws_2" } })));
  });
});
