import type { TextOverlay } from "./composition";
type PaintContext =
  | CanvasRenderingContext2D
  | OffscreenCanvasRenderingContext2D;
function direction(text: string): CanvasDirection {
  for (const letter of text) {
    if (/\p{Script=Arabic}|\p{Script=Hebrew}/u.test(letter)) return "rtl";
    if (/\p{Letter}/u.test(letter)) return "ltr";
  }
  return "rtl";
}

function wrapLines(context: PaintContext, text: string, maxWidth: number) {
  const lines: { text: string; direction: CanvasDirection }[] = [];
  const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
  for (const paragraph of text.replace(/\r\n?/g, "\n").split("\n")) {
    let line = "";
    const paragraphDirection = direction(paragraph);
    const push = () => {
      lines.push({ text: line.trimEnd(), direction: paragraphDirection });
      line = "";
    };
    for (const token of paragraph.split(/(\s+)/)) {
      if (!token) continue;
      if (context.measureText(line + token).width <= maxWidth) {
        line += token;
        continue;
      }
      if (line.trim()) push();
      if (!token.trim()) continue;
      if (context.measureText(token).width <= maxWidth) {
        line = token;
        continue;
      }
      // Keep Arabic combining marks attached when a long word needs wrapping.
      for (const { segment } of segmenter.segment(token)) {
        if (line && context.measureText(line + segment).width > maxWidth)
          push();
        line += segment;
      }
    }
    push();
  }
  return lines;
}

export function overlayLayout(context: PaintContext, overlay: TextOverlay) {
  const { text, ...style } = overlay;
  const position = overlay;
  let fontSize = style.fontSize;
  let lines: { text: string; direction: CanvasDirection }[] = [],
    lineHeight = 0,
    height = 0;
  for (let attempt = 0; attempt < 4; attempt++) {
    context.font = `${style.fontWeight} ${fontSize}px EditorArabic`;
    lines = wrapLines(context, text, 936);
    lineHeight = fontSize * 1.6;
    height = Math.ceil(lines.length * lineHeight + 48);
    if (height <= 1800) break;
    fontSize *= 1752 / (height - 48);
  }
  const width = Math.min(
    1000,
    Math.max(
      120,
      Math.ceil(
        Math.max(...lines.map((line) => context.measureText(line.text).width)) +
          64,
      ),
    ),
  );
  const x = Math.max(width / 2, Math.min(1080 - width / 2, position.x * 1080));
  const y = Math.max(
    height / 2,
    Math.min(1920 - height / 2, position.y * 1920),
  );
  return { ...style, width, height, fontSize, lineHeight, lines, x, y };
}

export function paintOverlay(
  context: PaintContext,
  layout: ReturnType<typeof overlayLayout>,
) {
  context.save();
  context.globalAlpha = layout.backgroundOpacity;
  context.fillStyle = layout.backgroundColor;
  context.fillRect(0, 0, layout.width, layout.height);
  context.globalAlpha = 1;
  context.fillStyle = layout.color;
  context.font = `${layout.fontWeight} ${layout.fontSize}px EditorArabic`;
  context.textAlign = layout.align;
  context.textBaseline = "middle";
  const x =
    layout.align === "left"
      ? 32
      : layout.align === "right"
        ? layout.width - 32
        : layout.width / 2;
  for (const [index, line] of layout.lines.entries()) {
    context.direction = line.direction;
    context.fillText(line.text, x, 24 + (index + 0.5) * layout.lineHeight);
  }
  context.restore();
}
