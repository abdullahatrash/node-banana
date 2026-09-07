import {
  clipDuration,
  clipSegments,
  duration,
  roles,
  VIDEO_FPS,
  type Clip,
  type Composition,
  type MediaRole,
  type Segment,
} from "./composition";
const frame = 1 / VIDEO_FPS;
const snap = (time: number) => Math.round(time * VIDEO_FPS) / VIDEO_FPS;
export function withSegments(clip: Clip, segments: Segment[]): Clip {
  return {
    ...clip,
    trimStart: segments[0].trimStart,
    trimEnd: segments.at(-1)!.trimEnd,
    segments: segments.length > 1 ? segments : undefined,
  };
}
export function sectionStart(clip: Clip, index: number) {
  return (
    clip.start +
    clipSegments(clip)
      .slice(0, index)
      .reduce(
        (total, segment) => total + segment.trimEnd - segment.trimStart,
        0,
      )
  );
}
export function splitClip(clip: Clip, time: number): Clip {
  const segments = clipSegments(clip);
  if (segments.length >= 32) return clip;
  const at = snap(time);
  let start = clip.start;
  for (const [index, segment] of segments.entries()) {
    const end = start + segment.trimEnd - segment.trimStart;
    if (at >= start + frame - 1e-6 && at <= end - frame + 1e-6) {
      const source = segment.trimStart + at - start;
      return withSegments(clip, [
        ...segments.slice(0, index),
        { trimStart: segment.trimStart, trimEnd: source },
        { trimStart: source, trimEnd: segment.trimEnd },
        ...segments.slice(index + 1),
      ]);
    }
    start = end;
  }
  return clip;
}
/** Remove a global timeline interval, closing its gap while preserving source synchronization. */
function removeRange(clip: Clip, from: number, to: number): Clip | null {
  const kept: Segment[] = [];
  let start = clip.start;
  for (const segment of clipSegments(clip)) {
    const end = start + segment.trimEnd - segment.trimStart;
    const before = Math.min(end, from) - start;
    const after = end - Math.max(start, to);
    if (before >= frame - 1e-6)
      kept.push({
        trimStart: segment.trimStart,
        trimEnd: segment.trimStart + before,
      });
    if (after >= frame - 1e-6)
      kept.push({
        trimStart: segment.trimEnd - after,
        trimEnd: segment.trimEnd,
      });
    start = end;
  }
  if (!kept.length) return null;
  return {
    ...withSegments(clip, kept),
    start:
      clip.start >= to ? clip.start - (to - from) : Math.min(clip.start, from),
  };
}
export function deleteSection(
  composition: Composition,
  role: MediaRole,
  index: number,
): Composition {
  const clip = composition[role];
  if (!clip) return composition;
  const segment = clipSegments(clip)[index];
  if (!segment) return composition;
  if (role === "main" && clipSegments(clip).length === 1) return composition;
  const from = sectionStart(clip, index),
    to = from + segment.trimEnd - segment.trimStart;
  const next = { ...composition };
  for (const target of role === "main" ? roles : [role]) {
    const value = next[target];
    if (value) next[target] = removeRange(value, from, to);
  }
  return next;
}
function fitLayers(composition: Composition) {
  const end = duration(composition);
  for (const role of roles) {
    if (role === "main") continue;
    const clip = composition[role];
    if (clip && clip.start + clipDuration(clip) > end)
      composition[role] = removeRange(clip, end, 86_400);
  }
  return composition;
}
export function trimSection(
  composition: Composition,
  role: MediaRole,
  index: number,
  edge: "trimStart" | "trimEnd",
  requested: number,
  sourceDuration: number,
): Composition {
  const clip = composition[role];
  if (!clip || !Number.isFinite(requested)) return composition;
  const segments = clipSegments(clip),
    segment = segments[index];
  if (!segment) return composition;
  const available =
    (role === "main"
      ? 60
      : Math.min(
          role === "secondary" ? 15 : 60,
          duration(composition) - clip.start,
        )) -
    (clipDuration(clip) - (segment.trimEnd - segment.trimStart));
  const min =
    edge === "trimStart"
      ? Math.max(segments[index - 1]?.trimEnd || 0, segment.trimEnd - available)
      : segment.trimStart + frame;
  const max =
    edge === "trimStart"
      ? segment.trimEnd - frame
      : Math.min(
          segments[index + 1]?.trimStart ?? sourceDuration,
          sourceDuration,
          segment.trimStart + available,
        );
  const value = Math.max(min, Math.min(max, snap(requested)));
  const next = {
    ...composition,
    [role]: withSegments(
      clip,
      segments.map((item, i) =>
        i === index ? { ...item, [edge]: value } : item,
      ),
    ),
  };
  return role === "main" ? fitLayers(next) : next;
}
export function moveClip(
  composition: Composition,
  role: MediaRole,
  requested: number,
): Composition {
  const clip = composition[role];
  if (!clip || role === "main") return composition;
  return {
    ...composition,
    [role]: {
      ...clip,
      start: Math.max(
        0,
        Math.min(duration(composition) - clipDuration(clip), snap(requested)),
      ),
    },
  };
}
