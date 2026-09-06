import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { LanguageSwitcher } from "../LanguageSwitcher";
import { DirectionHydrator } from "../DirectionHydrator";
import { I18nTestProvider } from "@/test/i18n";
import { useDirectionStore } from "@/store/directionStore";

const replace = vi.fn();
const refresh = vi.fn();
const pathname = vi.fn(() => "/en");

vi.mock("next/navigation", () => ({
  usePathname: () => pathname(),
  useRouter: () => ({ replace, refresh }),
}));

describe("LanguageSwitcher", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useDirectionStore.setState({ locale: "en", direction: "ltr" });
    document.documentElement.lang = "en";
    document.documentElement.dir = "ltr";
    window.localStorage.clear();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 204 })));
  });

  it("binds an authenticated product preference to the selected Workspace", async () => {
    window.localStorage.setItem("node-banana-active-workspace-id", "workspace-a");
    render(<I18nTestProvider locale="en"><LanguageSwitcher /></I18nTestProvider>);
    await userEvent.click(screen.getByRole("button", { name: "العربية" }));
    expect(fetch).toHaveBeenCalledWith("/api/preferences/locale", expect.objectContaining({
      headers: expect.objectContaining({ "x-workspace-id": "workspace-a" }),
    }));
  });

  it("has a localized accessible name and switches public route, document, and preference", async () => {
    render(
      <I18nTestProvider locale="en">
        <LanguageSwitcher />
      </I18nTestProvider>,
    );

    await userEvent.click(screen.getByRole("button", { name: "العربية" }));

    expect(document.documentElement).toHaveAttribute("lang", "ar");
    expect(document.documentElement).toHaveAttribute("dir", "rtl");
    expect(replace).toHaveBeenCalledWith("/ar");
    expect(fetch).toHaveBeenCalledWith("/api/preferences/locale", expect.objectContaining({
      method: "POST",
      body: JSON.stringify({ locale: "ar" }),
    }));
  });

  it("waits for the durable preference before navigating", async () => {
    let resolvePreference!: (response: Response) => void;
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>((resolve) => { resolvePreference = resolve; })));
    render(<I18nTestProvider locale="en"><LanguageSwitcher /></I18nTestProvider>);

    await userEvent.click(screen.getByRole("button", { name: "العربية" }));
    expect(screen.getByRole("button", { name: "العربية" })).toBeDisabled();
    expect(replace).not.toHaveBeenCalled();

    await act(async () => resolvePreference(new Response(null, { status: 204 })));
    await vi.waitFor(() => expect(replace).toHaveBeenCalledWith("/ar"));
  });

  it("restores the current direction when preference persistence fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 403 })));
    render(<I18nTestProvider locale="en"><LanguageSwitcher /></I18nTestProvider>);

    await userEvent.click(screen.getByRole("button", { name: "العربية" }));

    await vi.waitFor(() => expect(document.documentElement).toHaveAttribute("dir", "ltr"));
    expect(document.documentElement).toHaveAttribute("lang", "en");
    expect(replace).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
  });

  it("hydrates the direction store and document from server locale", async () => {
    render(
      <I18nTestProvider locale="ar">
        <DirectionHydrator locale="ar" />
      </I18nTestProvider>,
    );
    await vi.waitFor(() => expect(useDirectionStore.getState().locale).toBe("ar"));
    expect(document.documentElement).toHaveAttribute("dir", "rtl");
  });
});
