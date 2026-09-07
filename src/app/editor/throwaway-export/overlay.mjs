// Shared preview/export typography in the 1080 x 1920 output coordinate system.
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const color = (value, fallback) => /^#[0-9a-f]{6}$/i.test(value || '') ? value : fallback;
export const defaultTextStyle = { fontSize:76, fontWeight:400, align:'center', color:'#ffffff', backgroundColor:'#000000', backgroundOpacity:0.73 };

function direction(text) {
  for (const letter of text) {
    if (/\p{Script=Arabic}|\p{Script=Hebrew}/u.test(letter)) return 'rtl';
    if (/\p{Letter}/u.test(letter)) return 'ltr';
  }
  return 'rtl';
}

function wrapLines(context, text, maxWidth) {
  const lines = [];
  const segmenter = new Intl.Segmenter(undefined, { granularity:'grapheme' });
  for (const paragraph of text.replace(/\r\n?/g, '\n').split('\n')) {
    let line = '';
    const paragraphDirection = direction(paragraph);
    const push = () => { lines.push({ text:line.trimEnd(), direction:paragraphDirection }); line = ''; };
    for (const token of paragraph.split(/(\s+)/)) {
      if (!token) continue;
      if (context.measureText(line + token).width <= maxWidth) { line += token; continue; }
      if (line.trim()) push();
      if (!token.trim()) continue;
      if (context.measureText(token).width <= maxWidth) { line = token; continue; }
      // Keep Arabic combining marks attached when a long word needs wrapping.
      for (const { segment } of segmenter.segment(token)) {
        if (line && context.measureText(line + segment).width > maxWidth) push();
        line += segment;
      }
    }
    push();
  }
  return lines;
}

export function overlayLayout(context, text, position = { x: 0.5, y: 0.92 }, options = {}) {
  const style = {
    fontSize:clamp(Number(options.fontSize) || 76, 24, 160),
    fontWeight:[100,300,400,700].includes(Number(options.fontWeight)) ? Number(options.fontWeight) : 400,
    align:['left','center','right'].includes(options.align) ? options.align : 'center',
    color:color(options.color, '#ffffff'),
    backgroundColor:color(options.backgroundColor, '#000000'),
    backgroundOpacity:clamp(Number.isFinite(options.backgroundOpacity) ? options.backgroundOpacity : 0.73, 0, 1),
  };
  let fontSize = style.fontSize;
  let lines, lineHeight, height;
  for (let attempt = 0; attempt < 4; attempt++) {
    context.font = `${style.fontWeight} ${fontSize}px ReactionArabic`;
    lines = wrapLines(context, text, 936);
    lineHeight = fontSize * 1.6;
    height = Math.ceil(lines.length * lineHeight + 48);
    if (height <= 1800) break;
    fontSize *= 1752 / (height - 48);
  }
  const width = Math.min(1000, Math.max(120, Math.ceil(Math.max(...lines.map(line => context.measureText(line.text).width)) + 64)));
  const x = Math.max(width / 2, Math.min(1080 - width / 2, position.x * 1080));
  const y = Math.max(height / 2, Math.min(1920 - height / 2, position.y * 1920));
  return { ...style, width, height, fontSize, lineHeight, lines, x, y };
}

export function paintOverlay(context, text, layout) {
  context.save();
  context.globalAlpha = layout.backgroundOpacity;
  context.fillStyle = layout.backgroundColor;
  context.fillRect(0, 0, layout.width, layout.height);
  context.globalAlpha = 1;
  context.fillStyle = layout.color;
  context.font = `${layout.fontWeight} ${layout.fontSize}px ReactionArabic`;
  context.textAlign = layout.align;
  context.textBaseline = 'middle';
  const x = layout.align === 'left' ? 32 : layout.align === 'right' ? layout.width - 32 : layout.width / 2;
  for (const [index, line] of layout.lines.entries()) {
    context.direction = line.direction;
    context.fillText(line.text, x, 24 + (index + 0.5) * layout.lineHeight);
  }
  context.restore();
}
