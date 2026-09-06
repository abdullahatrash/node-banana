import { fireEvent, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { renderWithIntl as render } from "@/test/renderWithIntl";
import { SettingsSheet } from "../SettingsSheet";
import { I18nTestProvider } from "@/test/i18n";

const replace = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace }),
}));

describe("SettingsSheet", () => {
  it("uses modal dialog behavior and returns to the dashboard on Escape", async () => {
    replace.mockReset();
    render(
      <SettingsSheet>
        <h2 id="settings-title">Settings</h2>
        <p id="settings-description">Workspace settings</p>
      </SettingsSheet>,
    );

    expect(
      await screen.findByRole("dialog", { name: "Settings" }),
    ).toBeInTheDocument();
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/dashboard"));
  });

  it("opens from the mirrored physical left and exposes RTL direction in Arabic", async () => {
    render(
      <I18nTestProvider locale="ar">
        <SettingsSheet>
          <h2 id="settings-title">الإعدادات</h2>
          <p id="settings-description">إعدادات مساحة العمل</p>
        </SettingsSheet>
      </I18nTestProvider>,
    );

    const dialog = await screen.findByRole("dialog", { name: "الإعدادات" });
    expect(dialog).toHaveAttribute("dir", "rtl");
    expect(dialog).toHaveAttribute("data-side", "left");
    expect(dialog).toHaveClass(
      "data-[side=left]:left-0",
      "data-[side=left]:border-r",
      "data-[side=left]:w-full",
      "data-[side=left]:sm:max-w-none",
      "data-[side=left]:md:w-[min(52rem,calc(100vw-3rem))]",
    );
  });
});
