import { renderHook } from "@testing-library/react";
import { describe, expect, it, beforeEach, vi } from "vitest";
import { useGenerateShortcut } from "../useGenerateShortcut";
import { useSimpleStudioStore } from "@/store/simpleStudioStore";

function dispatchCmdEnter() {
  window.dispatchEvent(
    new KeyboardEvent("keydown", { key: "Enter", metaKey: true, bubbles: true })
  );
}

function dispatchCtrlEnter() {
  window.dispatchEvent(
    new KeyboardEvent("keydown", { key: "Enter", ctrlKey: true, bubbles: true })
  );
}

describe("useGenerateShortcut", () => {
  let generateSpy: ReturnType<typeof vi.fn<() => Promise<void>>>;

  beforeEach(() => {
    generateSpy = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
    useSimpleStudioStore.setState({
      prompt: "Hello world",
      isGenerating: false,
      isRewriting: false,
      generate: generateSpy,
    });
  });

  it("triggers generate on Cmd+Enter when on /simple-studio/images", () => {
    renderHook(() => useGenerateShortcut("/simple-studio/images"));
    dispatchCmdEnter();
    expect(generateSpy).toHaveBeenCalledTimes(1);
  });

  it("triggers generate on Ctrl+Enter (non-mac) on /simple-studio/videos", () => {
    renderHook(() => useGenerateShortcut("/simple-studio/videos"));
    dispatchCtrlEnter();
    expect(generateSpy).toHaveBeenCalledTimes(1);
  });

  it("triggers generate on /simple-studio/copy", () => {
    renderHook(() => useGenerateShortcut("/simple-studio/copy"));
    dispatchCmdEnter();
    expect(generateSpy).toHaveBeenCalledTimes(1);
  });

  it("does NOT fire on /simple-studio/library", () => {
    renderHook(() => useGenerateShortcut("/simple-studio/library"));
    dispatchCmdEnter();
    expect(generateSpy).not.toHaveBeenCalled();
  });

  it("does NOT fire on /simple-studio/prompt-library", () => {
    renderHook(() => useGenerateShortcut("/simple-studio/prompt-library"));
    dispatchCmdEnter();
    expect(generateSpy).not.toHaveBeenCalled();
  });

  it("does NOT fire when prompt is empty", () => {
    useSimpleStudioStore.setState({ prompt: "   " });
    renderHook(() => useGenerateShortcut("/simple-studio/images"));
    dispatchCmdEnter();
    expect(generateSpy).not.toHaveBeenCalled();
  });

  it("does NOT fire while already generating", () => {
    useSimpleStudioStore.setState({ isGenerating: true });
    renderHook(() => useGenerateShortcut("/simple-studio/images"));
    dispatchCmdEnter();
    expect(generateSpy).not.toHaveBeenCalled();
  });

  it("does NOT fire while rewriting", () => {
    useSimpleStudioStore.setState({ isRewriting: true });
    renderHook(() => useGenerateShortcut("/simple-studio/images"));
    dispatchCmdEnter();
    expect(generateSpy).not.toHaveBeenCalled();
  });

  it("cleans up its listener on unmount", () => {
    const { unmount } = renderHook(() =>
      useGenerateShortcut("/simple-studio/images")
    );
    unmount();
    dispatchCmdEnter();
    expect(generateSpy).not.toHaveBeenCalled();
  });
});
