export const builtInEditorEnabled =
  process.env.NEXT_PUBLIC_VIDEO_EDITOR_ENABLED === "true" ||
  process.env.NODE_ENV === "development";
