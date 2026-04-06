import type { SimpleStudioMode } from "@/store/simpleStudioStore";

export const URL_SEGMENT_TO_MODE: Record<"images" | "videos" | "copy", SimpleStudioMode> = {
  images: "photo",
  videos: "video",
  copy: "copy",
};

export const MODE_TO_URL_SEGMENT: Record<SimpleStudioMode, "images" | "videos" | "copy"> = {
  photo: "images",
  video: "videos",
  copy: "copy",
};

const PATH_REGEX = /^\/simple-studio\/(images|videos|copy)(?:\/|$)/;

export function modeFromPathname(pathname: string): SimpleStudioMode | null {
  const match = pathname.match(PATH_REGEX);
  if (!match) return null;
  const segment = match[1] as "images" | "videos" | "copy";
  return URL_SEGMENT_TO_MODE[segment] ?? null;
}
