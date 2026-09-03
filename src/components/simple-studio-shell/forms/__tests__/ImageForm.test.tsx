import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, beforeEach, vi } from "vitest";
import { ImageForm } from "../ImageForm";
import { useSimpleStudioStore } from "@/store/simpleStudioStore";
vi.mock("next-intl", () => ({ useTranslations: (namespace: string) => (key: string, values?: Record<string, number>) => namespace === "simpleStudio.generation" ? ({ generating: "Generating…", cancel: "Cancel", progress: "Generation progress" })[key] ?? key : namespace === "simpleStudio.forms" ? ({ prompt: "Prompt", generate: "Generate", enhancing: "Enhancing prompt…", enhance: "AI Prompt Enhance", enhanced: "Enhanced prompt", "image.referenceAlt": `Reference ${values?.number}`, "image.removeReference": `Remove reference image ${values?.number}`, "image.addReference": "Add reference image" })[key] ?? key : key }));

describe("ImageForm", () => {
  beforeEach(() => {
    useSimpleStudioStore.setState({
      mode: "photo",
      prompt: "",
      aspectRatio: "9:16",
      batchCount: 4,
      isGenerating: false,
      isRewriting: false,
      referenceImages: [],
      rewriteEnabled: false,
      rewrittenPrompt: null,
      selectedModelId: "qualified-model",
      rightsConfirmed: true,
    });
    // Stub fetch so ModelSelect's /api/models call doesn't race with test teardown
    global.fetch = vi.fn(() => new Promise(() => {})) as unknown as typeof fetch;
  });

  it("renders a prompt textarea", () => {
    render(<ImageForm />);
    expect(screen.getByLabelText("Prompt")).toBeInTheDocument();
  });

  it("renders a Generate button", () => {
    render(<ImageForm />);
    expect(screen.getByRole("button", { name: /generate/i })).toBeInTheDocument();
  });

  it("typing in the prompt textarea updates the store", async () => {
    render(<ImageForm />);
    const textarea = screen.getByLabelText("Prompt");
    await userEvent.type(textarea, "A cat");
    expect(useSimpleStudioStore.getState().prompt).toBe("A cat");
  });

  it("clicking Generate calls the store's generate action", async () => {
    const generateSpy = vi.fn().mockResolvedValue(undefined);
    useSimpleStudioStore.setState({
      prompt: "A cat",
      generate: generateSpy,
    });
    render(<ImageForm />);
    await userEvent.click(screen.getByRole("button", { name: /generate/i }));
    expect(generateSpy).toHaveBeenCalled();
  });

  it("Generate button is disabled when prompt is empty", () => {
    useSimpleStudioStore.setState({ prompt: "" });
    render(<ImageForm />);
    expect(screen.getByRole("button", { name: /generate/i })).toBeDisabled();
  });

  it("replaces Generate button with progress + Cancel while generating", () => {
    useSimpleStudioStore.setState({ prompt: "A cat", isGenerating: true });
    render(<ImageForm />);
    expect(
      screen.queryByRole("button", { name: /^generate$/i })
    ).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /cancel/i })).toBeInTheDocument();
    expect(screen.getByRole("progressbar")).toBeInTheDocument();
  });

  it("renders existing reference images from the store", () => {
    useSimpleStudioStore.setState({
      referenceImages: [
        "data:image/png;base64,AAA",
        "data:image/png;base64,BBB",
      ],
    });
    render(<ImageForm />);
    expect(screen.getByAltText("Reference 1")).toBeInTheDocument();
    expect(screen.getByAltText("Reference 2")).toBeInTheDocument();
  });

  it("removes a reference image when clicking ×", async () => {
    useSimpleStudioStore.setState({
      referenceImages: ["data:image/png;base64,AAA"],
    });
    render(<ImageForm />);
    await userEvent.click(
      screen.getByRole("button", { name: /remove reference image 1/i })
    );
    expect(useSimpleStudioStore.getState().referenceImages).toEqual([]);
  });

  it("hides the upload button when 3 reference images are present", () => {
    useSimpleStudioStore.setState({
      referenceImages: [
        "data:image/png;base64,AAA",
        "data:image/png;base64,BBB",
        "data:image/png;base64,CCC",
      ],
    });
    render(<ImageForm />);
    expect(
      screen.queryByLabelText(/add reference image/i)
    ).not.toBeInTheDocument();
  });

  it("keeps unadmitted AI Prompt Enhance disabled", async () => {
    render(<ImageForm />);
    const toggle = screen.getByRole("switch", { name: /ai prompt enhance/i });
    expect(toggle).toHaveAttribute("aria-checked", "false");
    await userEvent.click(toggle);
    expect(toggle).toBeDisabled();
    expect(useSimpleStudioStore.getState().rewriteEnabled).toBe(false);
  });

  it("shows enhanced prompt preview when rewriteEnabled and rewrittenPrompt set", () => {
    useSimpleStudioStore.setState({
      rewriteEnabled: true,
      rewrittenPrompt: "A photorealistic cat sitting on a windowsill",
    });
    render(<ImageForm />);
    expect(
      screen.getByText("A photorealistic cat sitting on a windowsill")
    ).toBeInTheDocument();
  });

  it("Generate button is disabled while rewriting", () => {
    useSimpleStudioStore.setState({ prompt: "A cat", isRewriting: true });
    render(<ImageForm />);
    expect(screen.getByRole("button", { name: /enhanc/i })).toBeDisabled();
  });
});
