import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import userEvent from "@testing-library/user-event";
import { SimpleStudioSiteHeader } from "../SimpleStudioSiteHeader";
import { SidebarProvider } from "@/components/ui/sidebar";
import { useSimpleStudioShellStore } from "@/store/simpleStudioShellStore";

const pathnameMock = vi.fn();
vi.mock("next/navigation", () => ({
  usePathname: () => pathnameMock(),
}));

function renderHeader() {
  return render(
    <SidebarProvider>
      <SimpleStudioSiteHeader />
    </SidebarProvider>,
  );
}

describe("SimpleStudioSiteHeader", () => {
  beforeEach(() => {
    useSimpleStudioShellStore.setState({
      savePromptDialogOpen: false,
      libraryModeFilter: "all",
      promptLibraryTab: "templates",
    });
  });

  it("shows 'Images' title on /simple-studio/images", () => {
    pathnameMock.mockReturnValue("/simple-studio/images");
    renderHeader();
    expect(screen.getByRole("heading", { name: "Images" })).toBeInTheDocument();
  });

  it("shows 'Library' title on /simple-studio/library", () => {
    pathnameMock.mockReturnValue("/simple-studio/library");
    renderHeader();
    expect(screen.getByRole("heading", { name: "Library" })).toBeInTheDocument();
  });

  it("shows 'Prompt Library' title on /simple-studio/prompt-library", () => {
    pathnameMock.mockReturnValue("/simple-studio/prompt-library");
    renderHeader();
    expect(screen.getByRole("heading", { name: "Prompt Library" })).toBeInTheDocument();
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
  });

  it("clicking a filter pill updates the store", async () => {
    pathnameMock.mockReturnValue("/simple-studio/library");
    renderHeader();
    await userEvent.click(screen.getByRole("button", { name: /^photo$/i }));
    expect(useSimpleStudioShellStore.getState().libraryModeFilter).toBe("photo");
  });
});
