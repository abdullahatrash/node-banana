// Shared preview/export geometry in the 1080 x 1920 output coordinate system.
export function overlayLayout(context, text, position = { x: 0.5, y: 0.92 }) {
  context.font = '76px ReactionArabic';
  const measured = context.measureText(text || ' ').width;
  const fontSize = Math.min(76, 936 / Math.max(1, measured) * 76);
  const width = Math.min(1000, Math.max(120, Math.ceil(measured * fontSize / 76 + 64)));
  const height = 144;
  const x = Math.max(width / 2, Math.min(1080 - width / 2, position.x * 1080));
  const y = Math.max(height / 2, Math.min(1920 - height / 2, position.y * 1920));
  return { width, height, fontSize, x, y };
}

export function paintOverlay(context, text, layout) {
  context.fillStyle = '#000b';
  context.fillRect(0, 0, layout.width, layout.height);
  context.fillStyle = 'white';
  context.font = `${layout.fontSize}px ReactionArabic`;
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.direction = 'rtl';
  context.fillText(text, layout.width / 2, layout.height / 2);
}
