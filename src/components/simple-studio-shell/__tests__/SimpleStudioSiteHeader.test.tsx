import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import userEvent from "@testing-library/user-event";
import { SimpleStudioHeaderActions } from "../SimpleStudioSiteHeader";
import { SidebarProvider } from "@/components/ui/sidebar";
import { useSimpleStudioShellStore } from "@/store/simpleStudioShellStore";
import { I18nTestProvider } from "@/test/i18n";

const pathnameMock = vi.fn();
vi.mock("next/navigation", () => ({
  usePathname: () => pathnameMock(),
}));

function renderHeader() {
  return render(
    <I18nTestProvider locale="en">
      <SidebarProvider>
        <SimpleStudioHeaderActions />
      </SidebarProvider>
    </I18nTestProvider>,
  );
}

describe("SimpleStudioHeaderActions", () => {
  beforeEach(() => {
    useSimpleStudioShellStore.setState({
      savePromptDialogOpen: false,
      libraryModeFilter: "all",
      promptLibraryTab: "templates",
    });
  });

  it("shows a Save prompt button on a form route", () => {
    pathnameMock.mockReturnValue("/simple-studio/images");
    renderHeader();
    expect(screen.getByRole("button", { name: /save prompt/i })).toBeInTheDocument();
  });

  it("Save prompt button opens the dialog via the store", async () => {
    pathnameMock.mockReturnValue("/simple-studio/images");
    renderHeader();
    await userEvent.click(screen.getByRole("button", { name: /save prompt/i }));
    expect(useSimpleStudioShellStore.getState().savePromptDialogOpen).toBe(true);
  });

  it("shows a New Saved Prompt button on the prompt-library route", () => {
    pathnameMock.mockReturnValue("/simple-studio/prompt-library");
    renderHeader();
    expect(screen.getByRole("button", { name: /new saved prompt/i })).toBeInTheDocument();
  });

  it("shows filter pills on the library route", () => {
    pathnameMock.mockReturnValue("/simple-studio/library");
    renderHeader();
    expect(screen.getByRole("button", { name: /^all$/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^photo$/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^video$/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^copy$/i })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: /filter library/i })).toHaveValue("all");
  });

  it("clicking a filter pill updates the store", async () => {
    pathnameMock.mockReturnValue("/simple-studio/library");
    renderHeader();
    await userEvent.click(screen.getByRole("button", { name: /^photo$/i }));
    expect(useSimpleStudioShellStore.getState().libraryModeFilter).toBe("photo");
  });

  it("changing the compact mobile filter updates the store", async () => {
    pathnameMock.mockReturnValue("/simple-studio/library");
    renderHeader();
    await userEvent.selectOptions(screen.getByRole("combobox", { name: /filter library/i }), "video");
    expect(useSimpleStudioShellStore.getState().libraryModeFilter).toBe("video");
  });
});
