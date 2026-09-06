import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { I18nTestProvider } from "@/test/i18n";

const showToast = vi.fn();

vi.mock("@/components/Toast", () => ({ useToast: () => ({ show: showToast }) }));
vi.mock("@/lib/studio/client", () => ({ getActiveWorkspaceId: () => "workspace-1" }));

import { WorkspacePreferencesSettings } from "../WorkspacePreferencesSettings";

const initialPreferences = {
  contentMarket: "SA" as const,
  timezone: "Asia/Riyadh",
  weekStartsOn: 6 as const,
};

describe("WorkspacePreferencesSettings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("fetch", vi.fn());
  });

  it("persists market, timezone, and week-start to the active Workspace", async () => {
    const user = userEvent.setup();
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({
      success: true,
      preferences: { contentMarket: "AE", timezone: "Asia/Dubai", weekStartsOn: 1 },
    }), { status: 200, headers: { "content-type": "application/json" } }));

    render(<I18nTestProvider locale="en"><WorkspacePreferencesSettings initialPreferences={initialPreferences} canManage /></I18nTestProvider>);
    await user.selectOptions(screen.getByLabelText("Primary content market"), "AE");
    await user.click(screen.getByRole("button", { name: "Use Asia/Dubai for this market" }));
    await user.selectOptions(screen.getByLabelText("Week starts on"), "1");
    await user.click(screen.getByRole("button", { name: "Save preferences" }));

    expect(fetch).toHaveBeenCalledWith("/api/studio/calendar/preferences", {
      method: "PATCH",
      headers: { "content-type": "application/json", "x-workspace-id": "workspace-1" },
      body: JSON.stringify({ contentMarket: "AE", timezone: "Asia/Dubai", weekStartsOn: 1 }),
    });
    expect(await screen.findByText("Preferences are current")).toBeInTheDocument();
    expect(showToast).toHaveBeenCalledWith("Workspace preferences saved", "success");
  });

  it("provides complete Arabic labels while keeping IANA keys left-to-right", () => {
    render(<I18nTestProvider locale="ar"><WorkspacePreferencesSettings initialPreferences={initialPreferences} canManage /></I18nTestProvider>);

    expect(screen.getByRole("heading", { name: "تفضيلات مساحة العمل" })).toBeInTheDocument();
    expect(screen.getByLabelText("سوق المحتوى الأساسي")).toHaveValue("SA");
    expect(screen.getByLabelText("المنطقة الزمنية بمعيار IANA")).toHaveAttribute("dir", "ltr");
    expect(screen.getByRole("option", { name: "فلسطين" })).toHaveValue("PS");
    expect(screen.getByRole("option", { name: "الجمعة" })).toHaveValue("5");
  });

  it("is visibly read-only without publishing permission", () => {
    render(<I18nTestProvider locale="en"><WorkspacePreferencesSettings initialPreferences={initialPreferences} canManage={false} /></I18nTestProvider>);

    expect(screen.getByRole("note")).toHaveTextContent("publishing permission is required");
    expect(screen.getByRole("button", { name: "Save preferences" })).toBeDisabled();
    expect(screen.getByLabelText("Primary content market")).toBeDisabled();
  });
});
