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
    });
    // Stub fetch so ModelSelect's /api/models call doesn't race with test teardown
    global.fetch = vi.fn(() => new Promise(() => {})) as unknown as typeof fetch;
  });

  it("renders a prompt textarea", () => {
    render(<VideoForm />);
    expect(screen.getByLabelText(/prompt/i)).toBeInTheDocument();
  });

  it("renders a Generate button", () => {
    render(<VideoForm />);
    expect(screen.getByRole("button", { name: /generate/i })).toBeInTheDocument();
  });

  it("typing updates the store prompt", async () => {
    render(<VideoForm />);
    await userEvent.type(screen.getByLabelText(/prompt/i), "Sunset");
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
});
