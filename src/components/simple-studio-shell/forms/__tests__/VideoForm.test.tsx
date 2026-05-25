import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, beforeEach, vi } from "vitest";
import { VideoForm } from "../VideoForm";
import { useSimpleStudioStore } from "@/store/simpleStudioStore";

describe("VideoForm", () => {
  beforeEach(() => {
    useSimpleStudioStore.setState({
      mode: "video",
      prompt: "",
      aspectRatio: "16:9",
      batchCount: 1,
      videoDuration: 5,
      isGenerating: false,
      isRewriting: false,
      sourceImage: null,
      rewriteEnabled: false,
      rewrittenPrompt: null,
      dialogueEnabled: false,
      dialogueLanguage: "en",
      dialogueText: "",
    });
    // Stub fetch so ModelSelect's /api/models call doesn't race with test teardown
    global.fetch = vi.fn(() => new Promise(() => {})) as unknown as typeof fetch;
  });

  it("renders a prompt textarea", () => {
    render(<VideoForm />);
    expect(screen.getByLabelText("Prompt")).toBeInTheDocument();
  });

  it("renders a Generate button", () => {
    render(<VideoForm />);
    expect(screen.getByRole("button", { name: /generate/i })).toBeInTheDocument();
  });

  it("typing updates the store prompt", async () => {
    render(<VideoForm />);
    await userEvent.type(screen.getByLabelText("Prompt"), "Sunset");
    expect(useSimpleStudioStore.getState().prompt).toBe("Sunset");
  });

  it("clicking Generate calls the store's generate action", async () => {
    const generateSpy = vi.fn().mockResolvedValue(undefined);
    useSimpleStudioStore.setState({ prompt: "Sunset", generate: generateSpy });
    render(<VideoForm />);
    await userEvent.click(screen.getByRole("button", { name: /generate/i }));
    expect(generateSpy).toHaveBeenCalled();
  });

  it("Generate button is disabled when prompt is empty", () => {
    useSimpleStudioStore.setState({ prompt: "" });
    render(<VideoForm />);
    expect(screen.getByRole("button", { name: /generate/i })).toBeDisabled();
  });

  it("renders source image preview from the store", () => {
    useSimpleStudioStore.setState({ sourceImage: "data:image/png;base64,AAA" });
    render(<VideoForm />);
    expect(screen.getByAltText("Source")).toBeInTheDocument();
  });

  it("removes source image when clicking ×", async () => {
    useSimpleStudioStore.setState({ sourceImage: "data:image/png;base64,AAA" });
    render(<VideoForm />);
    await userEvent.click(
      screen.getByRole("button", { name: /remove source image/i })
    );
    expect(useSimpleStudioStore.getState().sourceImage).toBeNull();
  });

  it("toggles AI Prompt Enhance via the store", async () => {
    render(<VideoForm />);
    const toggle = screen.getByRole("switch", { name: /ai prompt enhance/i });
    expect(toggle).toHaveAttribute("aria-checked", "false");
    await userEvent.click(toggle);
    expect(useSimpleStudioStore.getState().rewriteEnabled).toBe(true);
  });

  it("toggles dialogue and reveals language + text controls", async () => {
    render(<VideoForm />);
    expect(screen.queryByLabelText("Dialogue text")).not.toBeInTheDocument();
    await userEvent.click(
      screen.getByRole("switch", { name: /include dialogue/i })
    );
    expect(useSimpleStudioStore.getState().dialogueEnabled).toBe(true);
    expect(screen.getByLabelText("Dialogue text")).toBeInTheDocument();
  });

  it("typing in dialogue text updates the store", async () => {
    useSimpleStudioStore.setState({ dialogueEnabled: true });
    render(<VideoForm />);
    await userEvent.type(screen.getByLabelText("Dialogue text"), "Hello");
    expect(useSimpleStudioStore.getState().dialogueText).toBe("Hello");
  });

  it("switching dialogue language updates the store", async () => {
    useSimpleStudioStore.setState({ dialogueEnabled: true });
    render(<VideoForm />);
    await userEvent.click(screen.getByRole("button", { name: "عربي" }));
    expect(useSimpleStudioStore.getState().dialogueLanguage).toBe("ar");
  });

  it("offers batch preset 8", () => {
    render(<VideoForm />);
    // FormInfoPanel renders the batch presets — both 4 and 8 should be present
    expect(screen.getByRole("button", { name: "8" })).toBeInTheDocument();
  });
});
