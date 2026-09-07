import { fireEvent, render, screen } from "@testing-library/react";
import { useRef, useEffect, useMemo } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useEditorDraft } from "./useEditorDraft";
import { Timeline } from "./Timeline";
import { Preview, type PreviewHandle } from "./Preview";
import { editorCopy } from "./copy";
import { createClip, emptyComposition } from "@/lib/video-editor/composition";
import { createEditorClient } from "@/lib/video-editor/api";

beforeEach(() => {
  vi.stubGlobal("PointerEvent", MouseEvent);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
  Element.prototype.setPointerCapture = vi.fn();
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockReturnValue({
    x: 0,
    y: 0,
    left: 0,
    top: 0,
    right: 1000,
    bottom: 36,
    width: 1000,
    height: 36,
    toJSON: () => ({}),
  });
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
function Editor() {
  const api = useMemo(() => createEditorClient("ws"), []);
  const { composition, change, onGesture } = useEditorDraft(api, editorCopy.en);
  useEffect(
    () =>
      change(
        {
          ...emptyComposition(),
          main: createClip("main", 20),
          secondary: { ...createClip("secondary", 4), start: 8 },
        },
        true,
      ),
    [change],
  );
  const preview = useRef<PreviewHandle>(null);
  const media = Object.fromEntries(
    ["main", "secondary"].map((id) => [
      id,
      {
        id,
        name: id,
        type: "video" as const,
        url: `/${id}.mp4`,
        duration: 20,
        width: 1080,
        height: 1920,
      },
    ]),
  );
  return (
    <>
      <Preview
        ref={preview}
        composition={composition}
        media={media}
        copy={editorCopy.en}
        onChange={change}
        onSelectText={() => {}}
      />
      <Timeline
        composition={composition}
        selectedRole="secondary"
        selectedIndex={0}
        onSelect={() => {}}
        onChange={change}
        onError={() => {}}
        preview={preview}
        media={media}
        api={api}
        onGesture={onGesture}
        copy={editorCopy.en}
        busy={false}
      />
      <output data-testid="start">{composition.secondary?.start}</output>
    </>
  );
}
it("scrubs continuously through Secondary video while the pointer is held", () => {
  render(<Editor />);
  const ruler = screen.getByRole("slider", {
    name: editorCopy.en.scrub,
  });
  fireEvent.pointerDown(ruler, { clientX: 100 });
  expect(screen.getByLabelText(editorCopy.en.main)).toHaveProperty(
    "currentTime",
    2,
  );
  fireEvent.pointerMove(ruler, { clientX: 450 });
  expect(screen.getByLabelText(editorCopy.en.secondary)).toHaveProperty(
    "currentTime",
    1,
  );
  expect(screen.getByLabelText(editorCopy.en.secondary)).not.toHaveStyle({
    display: "none",
  });
  fireEvent.pointerMove(ruler, { clientX: 750 });
  expect(screen.getByLabelText(editorCopy.en.main)).toHaveProperty(
    "currentTime",
    15,
  );
  expect(screen.getByLabelText(editorCopy.en.secondary)).toHaveStyle({
    display: "none",
  });
  fireEvent.pointerUp(ruler);
});
it("moves Secondary by dragging its body and follows the moved clip in the preview", () => {
  render(<Editor />);
  const clip = screen.getByRole("button", {
    name: `${editorCopy.en.secondary} ${editorCopy.en.section} 1`,
  });
  fireEvent.pointerDown(clip, { clientX: 450 });
  fireEvent.pointerMove(clip, { clientX: 600 });
  expect(screen.getByTestId("start")).toHaveTextContent("11");
  expect(screen.getByLabelText(editorCopy.en.main)).toHaveProperty(
    "currentTime",
    12,
  );
  expect(screen.getByLabelText(editorCopy.en.secondary)).toHaveProperty(
    "currentTime",
    1,
  );
  fireEvent.pointerUp(clip);
});
it("shows the last retained frame while trimming Main instead of resetting to zero", () => {
  render(<Editor />);
  const end = screen.getByRole("slider", {
    name: `${editorCopy.en.main} 1: ${editorCopy.en.end}`,
  });
  fireEvent.pointerDown(end, { clientX: 1000 });
  fireEvent.pointerMove(end, { clientX: 750 });
  expect(screen.getByLabelText(editorCopy.en.main)).toHaveProperty(
    "currentTime",
    15 - 1 / 30,
  );
  fireEvent.pointerUp(end);
});
it("supports precise keyboard scrubbing and stops scrubbing after releasing the pointer", () => {
  render(<Editor />);
  const ruler = screen.getByRole("slider", { name: editorCopy.en.scrub });
  fireEvent.pointerDown(ruler, { clientX: 100 });
  fireEvent.pointerUp(ruler);
  fireEvent.pointerMove(ruler, { clientX: 450 });
  expect(screen.getByLabelText(editorCopy.en.main)).toHaveProperty(
    "currentTime",
    2,
  );
  fireEvent.keyDown(ruler, { key: "ArrowRight" });
  expect(screen.getByLabelText(editorCopy.en.main)).toHaveProperty(
    "currentTime",
    2 + 1 / 30,
  );
});
it("does not replay a clamped trim seek after scrubbing and changing the layout", () => {
  render(<Editor />);
  const end = screen.getByRole("slider", {
    name: `${editorCopy.en.main} 1: ${editorCopy.en.end}`,
  });
  fireEvent.pointerDown(end, { clientX: 1000 });
  fireEvent.pointerMove(end, { clientX: 1100 });
  fireEvent.pointerUp(end);
  const ruler = screen.getByRole("slider", { name: editorCopy.en.scrub });
  fireEvent.pointerDown(ruler, { clientX: 100 });
  fireEvent.pointerUp(ruler);
  fireEvent.click(
    screen.getByRole("button", { name: editorCopy.en.layouts.pip }),
  );
  expect(screen.getByLabelText(editorCopy.en.main)).toHaveProperty(
    "currentTime",
    2,
  );
});
it("previews the edited end frame when trimming with the keyboard", () => {
  render(<Editor />);
  const end = screen.getByRole("slider", {
    name: `${editorCopy.en.main} 1: ${editorCopy.en.end}`,
  });
  fireEvent.keyDown(end, { key: "ArrowLeft", shiftKey: true });
  expect(screen.getByLabelText(editorCopy.en.main)).toHaveProperty(
    "currentTime",
    19 - 1 / 30,
  );
});
