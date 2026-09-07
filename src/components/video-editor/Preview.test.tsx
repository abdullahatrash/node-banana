import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { Preview } from "./Preview";
import { editorCopy } from "./copy";
import { createClip, emptyComposition } from "@/lib/video-editor/composition";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("seeks across a one-frame deletion even when ordinary playback drift is below 100ms", () => {
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
  vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue();
  vi.spyOn(HTMLMediaElement.prototype, "readyState", "get").mockReturnValue(3);
  vi.spyOn(HTMLMediaElement.prototype, "seeking", "get").mockReturnValue(false);
  // At composition time 2 the decoder would still be at source time 2 without a seek.
  vi.spyOn(HTMLMediaElement.prototype, "currentTime", "get").mockReturnValue(2);
  const seek = vi
    .spyOn(HTMLMediaElement.prototype, "currentTime", "set")
    .mockImplementation(() => {});
  const now = vi.spyOn(performance, "now").mockReturnValue(0);
  let tick: FrameRequestCallback = () => {};
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    tick = callback;
    return 1;
  });
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  render(
    <Preview
      composition={{
        ...emptyComposition(),
        main: {
          ...createClip("main", 5),
          segments: [
            { trimStart: 0, trimEnd: 2 },
            { trimStart: 2 + 1 / 30, trimEnd: 5 },
          ],
        },
      }}
      media={{
        main: {
          id: "main",
          name: "Phone",
          url: "https://media.example/main.mp4",
          type: "video",
          duration: 5,
          width: 1080,
          height: 1920,
        },
      }}
      copy={editorCopy.en}
      onChange={vi.fn()}
      onSelectText={vi.fn()}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Play" }));
  seek.mockClear();
  now.mockReturnValue(2000);
  act(() => tick(2000));
  expect(seek).toHaveBeenCalledWith(2 + 1 / 30);
});
