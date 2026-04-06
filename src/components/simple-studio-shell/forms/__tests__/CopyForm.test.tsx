import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, beforeEach, vi } from "vitest";
import { CopyForm } from "../CopyForm";
import { useSimpleStudioStore } from "@/store/simpleStudioStore";

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
    });
  });

  it("renders a prompt textarea", () => {
    render(<CopyForm />);
    expect(screen.getByLabelText(/prompt/i)).toBeInTheDocument();
  });

  it("renders tone and platform selectors", () => {
    render(<CopyForm />);
    expect(screen.getByLabelText(/tone/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/platform/i)).toBeInTheDocument();
  });

  it("renders a Generate button", () => {
    render(<CopyForm />);
    expect(screen.getByRole("button", { name: /generate/i })).toBeInTheDocument();
  });

  it("clicking Generate calls generate", async () => {
    const generateSpy = vi.fn().mockResolvedValue(undefined);
    useSimpleStudioStore.setState({ prompt: "Ad copy", generate: generateSpy });
    render(<CopyForm />);
    await userEvent.click(screen.getByRole("button", { name: /generate/i }));
    expect(generateSpy).toHaveBeenCalled();
  });

  it("Generate is disabled with empty prompt", () => {
    useSimpleStudioStore.setState({ prompt: "" });
    render(<CopyForm />);
    expect(screen.getByRole("button", { name: /generate/i })).toBeDisabled();
  });
});
