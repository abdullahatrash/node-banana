import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { CreativeError } from "./contracts";

export const CREATIVE_FONT = {
  id: "noto-sans-arabic-v1",
  family: "Noto Sans Arabic",
  file: "assets/fonts/creative/NotoSansArabic.ttf",
  sha256: "63111b5b2e074dd48cc67692e0a2726d86ee94c1c37fe8598257b7b4e87e869e",
  source: "https://github.com/google/fonts/tree/main/ofl/notosansarabic",
  license: "SIL Open Font License 1.1",
} as const;

/** Reads Unicode cmap 4/12 instead of trusting host font fallback. The shipped
 * font hash is verified first; unsupported glyphs block export explicitly. */
export function fontHasCodePoint(font: Buffer, codePoint: number): boolean {
  const count = font.readUInt16BE(4);
  let cmap = 0;
  for (let index = 0; index < count; index++) {
    const offset = 12 + index * 16;
    if (font.toString("ascii", offset, offset + 4) === "cmap") cmap = font.readUInt32BE(offset + 8);
  }
  if (!cmap) return false;
  const tables = font.readUInt16BE(cmap + 2);
  for (let index = 0; index < tables; index++) {
    const record = cmap + 4 + index * 8;
    const platform = font.readUInt16BE(record); const encoding = font.readUInt16BE(record + 2);
    if (platform !== 0 && !(platform === 3 && (encoding === 1 || encoding === 10))) continue;
    const offset = cmap + font.readUInt32BE(record + 4); const format = font.readUInt16BE(offset);
    if (format === 12) {
      const groups = font.readUInt32BE(offset + 12);
      for (let group = 0; group < groups; group++) {
        const at = offset + 16 + group * 12; const first = font.readUInt32BE(at); const last = font.readUInt32BE(at + 4);
        if (codePoint >= first && codePoint <= last && font.readUInt32BE(at + 8) + codePoint - first !== 0) return true;
      }
    } else if (format === 4 && codePoint <= 0xffff) {
      const segments = font.readUInt16BE(offset + 6) / 2; const end = offset + 14; const start = end + segments * 2 + 2; const delta = start + segments * 2; const range = delta + segments * 2;
      for (let segment = 0; segment < segments; segment++) {
        const first = font.readUInt16BE(start + segment * 2); const last = font.readUInt16BE(end + segment * 2);
        if (codePoint < first || codePoint > last) continue;
        const change = font.readInt16BE(delta + segment * 2); const rangeOffset = font.readUInt16BE(range + segment * 2);
        if (!rangeOffset) { if ((codePoint + change & 0xffff) !== 0) return true; }
        else { const glyph = font.readUInt16BE(range + segment * 2 + rangeOffset + (codePoint - first) * 2); if (glyph !== 0 && (glyph + change & 0xffff) !== 0) return true; }
      }
    }
  }
  return false;
}

export async function loadCreativeFont(texts: string[], root = process.cwd()) {
  const path = join(root, CREATIVE_FONT.file);
  let bytes: Buffer;
  try { bytes = await readFile(path); } catch { throw new CreativeError("creative.errors.fontUnavailable"); }
  if (createHash("sha256").update(bytes).digest("hex") !== CREATIVE_FONT.sha256) throw new CreativeError("creative.errors.fontUnavailable");
  const codePoints = new Set(texts.flatMap((text) => Array.from(text, (character) => character.codePointAt(0)!)));
  for (const codePoint of codePoints) {
    if ([9, 10, 13, 0x200c, 0x200d].includes(codePoint)) continue;
    if (!fontHasCodePoint(bytes, codePoint)) throw new CreativeError("creative.errors.missingGlyph");
  }
  return { ...CREATIVE_FONT, path };
}
