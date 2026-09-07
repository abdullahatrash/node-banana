export const editorFonts = {
  sans: {
    family: "EditorArabic",
    file: "editor-arabic.ttf",
    weights: "100 900",
  },
  cairo: {
    family: "EditorCairo",
    file: "editor-cairo.ttf",
    weights: "200 1000",
  },
  naskh: {
    family: "EditorNaskh",
    file: "editor-naskh.ttf",
    weights: "400 700",
  },
} as const;
export type EditorFont = keyof typeof editorFonts;
export function overlayFont(value: { fontFamily?: EditorFont }) {
  return editorFonts[value.fontFamily || "sans"];
}
