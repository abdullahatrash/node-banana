import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, beforeEach, vi } from "vitest";
import { ImageForm } from "../ImageForm";
import { useSimpleStudioStore } from "@/store/simpleStudioStore";

describe("ImageForm", () => {
  beforeEach(() => {
    useSimpleStudioStore.setState({
      mode: "photo",
      prompt: "",
      aspectRatio: "1:1",
      batchCount: 4,
      isGenerating: false,
    });
  });

  it("renders a prompt textarea", () => {
    render(<ImageForm />);
    expect(screen.getByLabelText(/prompt/i)).toBeInTheDocument();
  });

  it("renders a Generate button", () => {
    render(<ImageForm />);
    expect(screen.getByRole("button", { name: /generate/i })).toBeInTheDocument();
  });

  it("typing in the prompt textarea updates the store", async () => {
    render(<ImageForm />);
    const textarea = screen.getByLabelText(/prompt/i);
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

  it("Generate button is disabled while generating", () => {
    useSimpleStudioStore.setState({ prompt: "A cat", isGenerating: true });
    render(<ImageForm />);
    expect(screen.getByRole("button", { name: /generate/i })).toBeDisabled();
  });
});
