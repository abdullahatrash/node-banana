import { render, screen } from "@testing-library/react";
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
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 204 })));
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
