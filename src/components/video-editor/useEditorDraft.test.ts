import { act, renderHook } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { createEditorClient } from "@/lib/video-editor/api";
import { createClip, emptyComposition } from "@/lib/video-editor/composition";
import { useEditorDraft } from "./useEditorDraft";
import { editorCopy } from "./copy";

afterEach(() => vi.restoreAllMocks());
it("undoes a whole drag even after a pause, and keeps the next drag separate", () => {
  const now = vi.spyOn(performance, "now").mockReturnValue(0);
  const api = createEditorClient("ws");
  const { result } = renderHook(() => useEditorDraft(api, editorCopy.en));
  const original = {
    ...emptyComposition(),
    main: createClip("main", 20),
    secondary: { ...createClip("secondary", 4), start: 8 },
  };
  act(() => result.current.change(original, true));
  act(() => result.current.onGesture(true));
  act(() =>
    result.current.change({
      ...original,
      secondary: { ...original.secondary, start: 9 },
    }),
  );
  now.mockReturnValue(3000);
  act(() =>
    result.current.change({
      ...original,
      secondary: { ...original.secondary, start: 11 },
    }),
  );
  act(() => result.current.onGesture(false));
  act(() => result.current.undo());
  expect(result.current.composition.secondary?.start).toBe(8);
  act(() => result.current.redo());
  expect(result.current.composition.secondary?.start).toBe(11);
  act(() => result.current.onGesture(true));
  act(() =>
    result.current.change({
      ...original,
      secondary: { ...original.secondary, start: 12 },
    }),
  );
  act(() => result.current.onGesture(false));
  act(() => result.current.undo());
  expect(result.current.composition.secondary?.start).toBe(11);
});
