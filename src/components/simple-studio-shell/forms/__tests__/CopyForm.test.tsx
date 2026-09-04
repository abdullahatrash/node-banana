import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, beforeEach, vi } from "vitest";
import { CopyForm } from "../CopyForm";
import { useSimpleStudioStore } from "@/store/simpleStudioStore";

vi.mock("next-intl", () => ({
  useTranslations: (namespace: string) => (key: string) =>
    namespace === "simpleStudio.generation"
      ? ({
          generating: "Generating…",
          cancel: "Cancel",
          progress: "Generation progress",
          viewAsset: "View asset",
        })[key] ?? key
      : namespace === "simpleStudio.forms"
        ? ({ prompt: "Prompt", generate: "Generate", "copy.tone": "Tone", "copy.platform": "Platform", "copy.unavailable": "Copy generation is paused", "languages.en": "English", "languages.ar": "عربي", "languages.both": "Both" })[key] ?? key
        : key,
}));

describe("CopyForm", () => {
  beforeEach(() => {
    useSimpleStudioStore.setState({
      mode: "copy",
      prompt: "",
      tone: "professional",
      platform: "general",
      copyModelId: "gemini-2.5-flash",
      batchCount: 1,
      isGenerating: false,
      outputLanguage: "en",
      selectedModelId: "qualified-copy-model",
      selectedModelProvider: "replicate",
      selectedModelVersion: "immutable-version",
      selectedModelSchemaDigest: `sha256:${"a".repeat(64)}`,
      rightsConfirmed: true,
      generationsByMode: { photo: [], video: [], copy: [] },
      generations: [],
    });
    global.fetch = vi.fn(() => new Promise(() => {})) as unknown as typeof fetch;
  });

  it("renders a prompt textarea with automatic bidi direction", () => {
    render(<CopyForm />);
    expect(screen.getByLabelText(/prompt/i)).toHaveAttribute("dir", "auto");
  });

  it("renders tone and platform selectors", () => {
    render(<CopyForm />);
    expect(screen.getByLabelText(/tone/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/platform/i)).toBeInTheDocument();
  });

  it("stacks paired selectors until the small-screen breakpoint", () => {
    const { container } = render(<CopyForm />);
    expect(container.querySelector(".grid-cols-1.sm\\:grid-cols-2")).toBeInTheDocument();
  });

  it("renders a Generate button", () => {
    render(<CopyForm />);
    expect(screen.getByRole("button", { name: /generate/i })).toBeInTheDocument();
  });

  it("submits Copy through the admitted generation action", async () => {
    const generateSpy = vi.fn().mockResolvedValue(undefined);
    useSimpleStudioStore.setState({ prompt: "Ad copy", generate: generateSpy });
    render(<CopyForm />);
    await userEvent.click(screen.getByRole("button", { name: /generate/i }));
    expect(generateSpy).toHaveBeenCalledOnce();
  });

  it("Generate is disabled with empty prompt", () => {
    useSimpleStudioStore.setState({ prompt: "" });
    render(<CopyForm />);
    expect(screen.getByRole("button", { name: /generate/i })).toBeDisabled();
  });

  it("renders output language buttons", () => {
    render(<CopyForm />);
    expect(screen.getByRole("button", { name: "English" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "عربي" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Both" })).toBeInTheDocument();
  });

  it("clicking an output language updates the store", async () => {
    render(<CopyForm />);
    await userEvent.click(screen.getByRole("button", { name: "Both" }));
    expect(useSimpleStudioStore.getState().outputLanguage).toBe("both");
  });

  it("gives mixed-language generated copy its own automatic direction", () => {
    const result = {
      id: "generation-1",
      batchId: "batch-1",
      status: "complete" as const,
      result: "English result داخل واجهة عربية",
      assetId: null,
      error: null,
      mode: "copy" as const,
      aspectRatio: "9:16",
      prompt: "Prompt",
      createdAt: Date.now(),
      modelName: "model",
    };
    useSimpleStudioStore.setState({
      generationsByMode: { photo: [], video: [], copy: [result] },
      generations: [result],
    });

    render(<CopyForm />);
    expect(screen.getByText(result.result)).toHaveAttribute("dir", "auto");
  });
});
