import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { I18nTestProvider } from "@/test/i18n";

const showToast = vi.fn();
vi.mock("@/components/Toast", () => ({ useToast: () => ({ show: showToast }) }));

import { WorkspaceNotificationSettings } from "../WorkspaceNotificationSettings";

describe("WorkspaceNotificationSettings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ success: true, preferences: { inAppEnabled: true, emailEnabled: false, webhookEnabled: false, muteAll: false, preferences: null } }), { status: 200, headers: { "content-type": "application/json" } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ success: true, preferences: { inAppEnabled: true, emailEnabled: true, webhookEnabled: false, muteAll: true, preferences: { schema: "social-notification-preferences/v1", deliveryLocale: "en", digestCadence: "weekly", weeklyDigestDay: 1, quietHours: { enabled: true, start: "23:00", end: "07:00", timeZone: "Asia/Riyadh" }, categories: { publishingProgress: true, publishingSuccess: false, channelUpdates: true } } } }), { status: 200, headers: { "content-type": "application/json" } })),
    );
  });

  it("loads safe defaults and saves personal Workspace-scoped delivery policy", async () => {
    const user = userEvent.setup();
    render(<I18nTestProvider locale="en"><WorkspaceNotificationSettings workspaceId="workspace-1" interfaceLocale="en" workspaceTimeZone="Asia/Riyadh" /></I18nTestProvider>);

    await screen.findByRole("heading", { name: "Notification preferences" });
    await user.click(screen.getByRole("checkbox", { name: /Email digest/ }));
    await user.click(screen.getByRole("checkbox", { name: /Mute optional activity/ }));
    await user.selectOptions(screen.getByLabelText("Email digest cadence"), "weekly");
    await user.selectOptions(screen.getByLabelText("Weekly digest day"), "1");
    await user.clear(screen.getByLabelText("Starts"));
    await user.type(screen.getByLabelText("Starts"), "23:00");
    await user.clear(screen.getByLabelText("Ends"));
    await user.type(screen.getByLabelText("Ends"), "07:00");
    await user.click(screen.getByRole("checkbox", { name: /Publishing success/ }));
    await user.click(screen.getByRole("button", { name: "Save notification preferences" }));

    await waitFor(() => expect(fetch).toHaveBeenNthCalledWith(2, "/api/social/notifications/preferences", expect.objectContaining({
      method: "PUT",
      headers: { "content-type": "application/json", "x-workspace-id": "workspace-1" },
    })));
    const request = vi.mocked(fetch).mock.calls[1][1] as RequestInit;
    expect(JSON.parse(String(request.body))).toMatchObject({
      emailEnabled: true,
      muteAll: true,
      preferences: { deliveryLocale: "en", digestCadence: "weekly", weeklyDigestDay: 1, quietHours: { start: "23:00", end: "07:00", timeZone: "Asia/Riyadh" }, categories: { publishingSuccess: false } },
    });
    expect(showToast).toHaveBeenCalledWith("Notification preferences saved", "success");
  });

  it("renders the non-disableable boundary in authored Arabic", async () => {
    render(<I18nTestProvider locale="ar"><WorkspaceNotificationSettings workspaceId="workspace-1" interfaceLocale="ar" workspaceTimeZone="Asia/Riyadh" /></I18nTestProvider>);
    expect(await screen.findByRole("note")).toHaveTextContent("لا يمكن للكتم");
    expect(screen.getByLabelText("لغة الإشعارات")).toHaveValue("ar");
  });
});
