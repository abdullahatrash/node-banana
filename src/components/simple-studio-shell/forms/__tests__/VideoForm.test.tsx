import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, beforeEach, vi } from "vitest";
import { VideoForm } from "../VideoForm";
import { useSimpleStudioStore } from "@/store/simpleStudioStore";
vi.mock("next-intl", () => ({ useLocale: () => "ar", useTranslations: (namespace: string) => (key: string, values?: Record<string, number>) => namespace === "simpleStudio.generation" ? ({ generating: "Generating…", cancel: "Cancel", progress: "Generation progress" })[key] ?? key : namespace === "simpleStudio.forms" ? ({ prompt: "Prompt", generate: "Generate", enhancing: "Enhancing prompt…", enhance: "AI Prompt Enhance", "video.sourceImageAlt": "Source", "video.removeSource": "Remove source image", "video.includeDialogue": "Include dialogue", "video.dialogueText": "Dialogue text", "video.duration": "المدة", "video.durationValue": `${values?.seconds ?? ""} ث`, "video.durationHint": "تعتمد المدد المتاحة على النموذج المعتمد.", "video.durationModelLimit": `الحد الأقصى ${values?.seconds ?? ""} ث`, "languages.en": "English", "languages.ar": "عربي" })[key] ?? key : key }));

describe("VideoForm", () => {
  beforeEach(() => {
    useSimpleStudioStore.setState({
      mode: "video",
      prompt: "",
      aspectRatio: "9:16",
      batchCount: 1,
      videoDuration: 5,
      isGenerating: false,
      isRewriting: false,
      sourceImage: null,
      sourceMediaType: null,
      rewriteEnabled: false,
      rewrittenPrompt: null,
      dialogueEnabled: false,
      dialogueLanguage: "en",
      dialogueText: "",
      selectedModelId: "qualified-model",
      selectedModelMaxQuantity: 10,
      rightsConfirmed: true,
    });
    // Stub fetch so ModelSelect's /api/models call doesn't race with test teardown
    global.fetch = vi.fn(() => new Promise(() => {})) as unknown as typeof fetch;
  });

  it("renders a prompt textarea with automatic bidi direction", () => {
    render(<VideoForm />);
    expect(screen.getByLabelText("Prompt")).toHaveAttribute("dir", "auto");
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
    useSimpleStudioStore.setState({ sourceImage: "data:image/png;base64,AAA", sourceMediaType: "image" });
    render(<VideoForm />);
    expect(screen.getByAltText("Source")).toBeInTheDocument();
  });

  it("removes source image when clicking ×", async () => {
    useSimpleStudioStore.setState({ sourceImage: "data:image/png;base64,AAA", sourceMediaType: "image" });
    render(<VideoForm />);
    await userEvent.click(
      screen.getByRole("button", { name: /remove source image/i })
    );
    expect(useSimpleStudioStore.getState().sourceImage).toBeNull();
  });

  it("keeps unadmitted AI Prompt Enhance disabled", async () => {
    render(<VideoForm />);
    const toggle = screen.getByRole("switch", { name: /ai prompt enhance/i });
    expect(toggle).toHaveAttribute("aria-checked", "false");
    await userEvent.click(toggle);
    expect(toggle).toBeDisabled();
    expect(useSimpleStudioStore.getState().rewriteEnabled).toBe(false);
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

  it("renders only duration presets admitted by the selected model", () => {
    useSimpleStudioStore.setState({ selectedModelMaxQuantity: 6, videoDuration: 5 });

    render(<VideoForm />);

    expect(screen.getByRole("group", { name: "المدة" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "4 ث" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "6 ث" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "8 ث" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "10 ث" })).not.toBeInTheDocument();
  });

  it("clamps a stale duration when the model contract changes", async () => {
    useSimpleStudioStore.getState().setSelectedModel("video-model", "replicate", "Video", "v1", `sha256:${"a".repeat(64)}`, { basis: "second", amount: 0.01 }, 6);
    useSimpleStudioStore.getState().setVideoDuration(10);

    await waitFor(() => expect(useSimpleStudioStore.getState().videoDuration).toBe(6));
  });
});
