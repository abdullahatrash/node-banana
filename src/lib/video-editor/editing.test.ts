import { expect, it } from "vitest";
import {
  compositionSchema,
  createClip,
  emptyComposition,
  duration,
  sourceTime,
  clipSegments,
} from "./composition";
import { splitClip, deleteSection, trimSection } from "./editing";

it("splits without changing source timing, then removes the middle with synchronized ripple", () => {
  let value = {
    ...emptyComposition(),
    main: createClip("phone", 10),
    music: createClip("music", 10),
  };
  value = { ...value, main: splitClip(value.main, 3) };
  value = { ...value, main: splitClip(value.main, 6) };
  expect(clipSegments(value.main)).toHaveLength(3);
  expect(sourceTime(value.main, 7)).toBe(7);
  const cut = deleteSection(value, "main", 1);
  expect(duration(cut)).toBe(7);
  expect(sourceTime(cut.main!, 3)).toBe(6);
  expect(sourceTime(cut.music!, 3)).toBe(6);
  expect(compositionSchema.safeParse(cut).success).toBe(true);
});

it("moves later layers earlier and removes layers wholly inside a deleted main section", () => {
  const value = {
    ...emptyComposition(),
    main: splitClip(splitClip(createClip("phone", 10), 3), 6),
    secondary: { ...createClip("second", 2), start: 7 },
    voiceover: { ...createClip("voice", 1), start: 4 },
  };
  const cut = deleteSection(value, "main", 1);
  expect(cut.secondary?.start).toBe(4);
  expect(cut.voiceover).toBeNull();
});

it("clamps trims to valid frames/source bounds and fits dependent audio when the main shortens", () => {
  const value = {
    ...emptyComposition(),
    main: createClip("phone", 10),
    music: createClip("music", 10),
  };
  const trimmed = trimSection(value, "main", 0, "trimEnd", 5, 10);
  expect(duration(trimmed)).toBe(5);
  expect(trimmed.music?.trimEnd).toBe(5);
  expect(duration(trimSection(value, "main", 0, "trimEnd", 99, 10))).toBe(10);
  expect(
    compositionSchema.safeParse(
      trimSection(value, "main", 0, "trimStart", 99, 10),
    ).success,
  ).toBe(true);
});

it("rejects forged segment ranges beyond the declared source bounds and keeps old drafts compatible", () => {
  const value = { ...emptyComposition(), main: createClip("phone", 10) };
  expect(compositionSchema.safeParse(value).success).toBe(true);
  expect(
    compositionSchema.safeParse({
      ...value,
      main: { ...value.main, segments: [{ trimStart: 0, trimEnd: 999 }] },
    }).success,
  ).toBe(false);
  expect(splitClip(value.main, 0)).toEqual(value.main);
});
