import { render as testingRender, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactElement } from "react";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it, beforeEach, vi } from "vitest";
import { SavePromptDialog } from "../SavePromptDialog";
import { useSimpleStudioStore } from "@/store/simpleStudioStore";
import { useSimpleStudioShellStore } from "@/store/simpleStudioShellStore";
import messages from "@/i18n/messages/en.json";

function render(ui: ReactElement) {
  return testingRender(
    <NextIntlClientProvider locale="en" messages={messages}>
      {ui}
    </NextIntlClientProvider>,
  );
}

describe("SavePromptDialog", () => {
  beforeEach(() => {
    useSimpleStudioShellStore.setState({ savePromptDialogOpen: true });
    useSimpleStudioStore.setState({ prompt: "A cat", mode: "photo" });
  });

  it("renders the dialog when open is true", () => {
    render(<SavePromptDialog />);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("shows a name input", () => {
    render(<SavePromptDialog />);
    expect(screen.getByLabelText(/name/i)).toBeInTheDocument();
  });

  it("shows an editable prompt textarea seeded with the current store prompt", () => {
    render(<SavePromptDialog />);
    const textarea = screen.getByLabelText(/prompt text/i) as HTMLTextAreaElement;
    expect(textarea).toBeInTheDocument();
    expect(textarea).toHaveAttribute("dir", "auto");
    expect(textarea.value).toBe("A cat");
  });

  it("calls setPrompt then saveCurrentPrompt with the edited prompt on Save", async () => {
    const setPromptSpy = vi.fn();
    const saveSpy = vi.fn().mockResolvedValue(undefined);
    useSimpleStudioStore.setState({ setPrompt: setPromptSpy, saveCurrentPrompt: saveSpy });
    render(<SavePromptDialog />);
    const textarea = screen.getByLabelText(/prompt text/i);
    await userEvent.clear(textarea);
    await userEvent.type(textarea, "A fluffy cat");
    await userEvent.type(screen.getByLabelText(/name/i), "Cat v2");
    await userEvent.click(screen.getByRole("button", { name: /^save$/i }));
    expect(setPromptSpy).toHaveBeenCalledWith("A fluffy cat");
    expect(saveSpy).toHaveBeenCalledWith("Cat v2");
    expect(useSimpleStudioShellStore.getState().savePromptDialogOpen).toBe(false);
  });

  it("Save button is disabled when name is empty", () => {
    render(<SavePromptDialog />);
    expect(screen.getByRole("button", { name: /^save$/i })).toBeDisabled();
  });

  it("Save button is disabled when prompt text is empty", async () => {
    useSimpleStudioStore.setState({ prompt: "" });
    render(<SavePromptDialog />);
    await userEvent.type(screen.getByLabelText(/name/i), "Empty");
    expect(screen.getByRole("button", { name: /^save$/i })).toBeDisabled();
  });

  it("does not render when open is false", () => {
    useSimpleStudioShellStore.setState({ savePromptDialogOpen: false });
    render(<SavePromptDialog />);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
