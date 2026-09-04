import { render as testingRender, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactElement } from "react";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it, beforeEach, vi } from "vitest";
import { PromptLibraryTabs } from "../PromptLibraryTabs";
import {
  useSimpleStudioStore,
  type SavedPrompt,
} from "@/store/simpleStudioStore";
import { useSimpleStudioShellStore } from "@/store/simpleStudioShellStore";
import messages from "@/i18n/messages/en.json";

function render(ui: ReactElement) {
  return testingRender(
    <NextIntlClientProvider locale="en" messages={messages}>
      {ui}
    </NextIntlClientProvider>,
  );
}

const routerPush = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: routerPush }),
}));

function makePrompt(overrides: Partial<SavedPrompt>): SavedPrompt {
  return {
    id: "p1",
    mode: "photo",
    name: "Demo",
    promptText: "Demo prompt",
    formConfig: {},
    isPublic: false,
    ...overrides,
  };
}

describe("PromptLibraryTabs", () => {
  beforeEach(() => {
    routerPush.mockClear();
    useSimpleStudioShellStore.setState({ promptLibraryTab: "templates" });
    useSimpleStudioStore.setState({
      savedPrompts: [
        makePrompt({ id: "s1", name: "Saved one", promptText: "Saved text" }),
      ],
      publicPrompts: [
        makePrompt({
          id: "t1",
          name: "Template one",
          promptText: "Template text",
          isPublic: true,
        }),
      ],
      applyPrompt: vi.fn(),
      loadSavedPrompts: vi.fn().mockResolvedValue(undefined),
      loadPublicPrompts: vi.fn().mockResolvedValue(undefined),
    });
  });

  it("shows templates by default", () => {
    render(<PromptLibraryTabs />);
    expect(screen.getByText("Template one")).toBeInTheDocument();
  });

  it("switches to Saved tab on click", async () => {
    render(<PromptLibraryTabs />);
    await userEvent.click(screen.getByRole("tab", { name: /saved/i }));
    expect(screen.getByText("Saved one")).toBeInTheDocument();
    expect(useSimpleStudioShellStore.getState().promptLibraryTab).toBe("saved");
  });

  it("clicking Use on a template applies and navigates", async () => {
    const applySpy = vi.fn();
    useSimpleStudioStore.setState({ applyPrompt: applySpy });
    render(<PromptLibraryTabs />);
    await userEvent.click(screen.getByRole("button", { name: /use/i }));
    expect(applySpy).toHaveBeenCalled();
    expect(routerPush).toHaveBeenCalledWith("/simple-studio/images");
  });

  it("shows empty state when no templates", () => {
    useSimpleStudioStore.setState({ publicPrompts: [] });
    render(<PromptLibraryTabs />);
    expect(screen.getByText(/no templates yet/i)).toBeInTheDocument();
  });

  it("shows empty state when no saved prompts", async () => {
    useSimpleStudioStore.setState({ savedPrompts: [] });
    render(<PromptLibraryTabs />);
    await userEvent.click(screen.getByRole("tab", { name: /saved/i }));
    expect(screen.getByText(/no saved prompts yet/i)).toBeInTheDocument();
  });
});
