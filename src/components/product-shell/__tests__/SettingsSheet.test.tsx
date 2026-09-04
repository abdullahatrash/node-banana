import { fireEvent, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { renderWithIntl as render } from "@/test/renderWithIntl";
import { SettingsSheet } from "../SettingsSheet";

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
});
