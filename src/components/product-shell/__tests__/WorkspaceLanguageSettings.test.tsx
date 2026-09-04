import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { I18nTestProvider } from "@/test/i18n";
import { useDirectionStore } from "@/store/directionStore";

const showToast = vi.fn();
const refresh = vi.fn();

vi.mock("@/components/Toast", () => ({ useToast: () => ({ show: showToast }) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

import { WorkspaceLanguageSettings } from "../WorkspaceLanguageSettings";

describe("WorkspaceLanguageSettings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useDirectionStore.setState({ locale: "ar", direction: "rtl" });
    document.documentElement.lang = "ar";
    document.documentElement.dir = "rtl";
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      if (String(input) === "/api/preferences/locale") return new Response(null, { status: 204 });
      return new Response(JSON.stringify({ success: true, contentLanguage: "en" }), { status: 200, headers: { "content-type": "application/json" } });
    }));
  });

  it("persists per-person interface locale separately from Workspace content language", async () => {
    const user = userEvent.setup();
    render(<I18nTestProvider locale="ar"><WorkspaceLanguageSettings workspaceId="workspace-1" initialInterfaceLocale="ar" initialContentLanguage="ar" canManageContent /></I18nTestProvider>);

    await user.selectOptions(screen.getByLabelText("لغة الواجهة"), "en");
    await user.click(screen.getByRole("button", { name: "حفظ لغة الواجهة" }));
    expect(fetch).toHaveBeenCalledWith("/api/preferences/locale", expect.objectContaining({
      method: "POST",
      headers: expect.objectContaining({ "x-workspace-id": "workspace-1" }),
      body: JSON.stringify({ locale: "en" }),
    }));
    await waitFor(() => expect(document.documentElement).toHaveAttribute("dir", "ltr"));

    await user.selectOptions(screen.getByLabelText("لغة المحتوى الافتراضية"), "en");
    await user.click(screen.getByRole("button", { name: "حفظ لغة المحتوى" }));
    expect(fetch).toHaveBeenCalledWith("/api/studio/preferences/content-language", {
      method: "PATCH",
      headers: { "content-type": "application/json", "x-workspace-id": "workspace-1" },
      body: JSON.stringify({ contentLanguage: "en" }),
    });
    expect(showToast).toHaveBeenCalledWith("حُفظت لغة المحتوى الافتراضية", "success");
  });

  it("keeps content-language controls read-only without content-write permission", () => {
    render(<I18nTestProvider locale="en"><WorkspaceLanguageSettings workspaceId="workspace-1" initialInterfaceLocale="en" initialContentLanguage="ar" canManageContent={false} /></I18nTestProvider>);

    expect(screen.getByRole("note")).toHaveTextContent("content creation permission is required");
    expect(screen.getByLabelText("Default content language")).toBeDisabled();
    expect(screen.getByLabelText("Interface language")).toBeEnabled();
  });
});
