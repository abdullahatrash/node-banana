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
      outputLanguage: "en",
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

  it("keeps generation disabled while text adapters are unadmitted", async () => {
    const generateSpy = vi.fn().mockResolvedValue(undefined);
    useSimpleStudioStore.setState({ prompt: "Ad copy", generate: generateSpy });
    render(<CopyForm />);
    await userEvent.click(screen.getByRole("button", { name: /generate/i }));
    expect(generateSpy).not.toHaveBeenCalled();
    expect(screen.getByRole("status")).toHaveTextContent(/paused/i);
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
});
