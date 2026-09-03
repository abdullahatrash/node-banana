const ARABIC_DIACRITICS = /[\u0610-\u061a\u064b-\u065f\u0670\u06d6-\u06ed]/gu;
const TATWEEL = /\u0640/gu;
const WHITESPACE = /\s+/gu;

export function normalizeArabicSearch(value: string) {
  return value
    .normalize("NFKC")
    .replace(TATWEEL, "")
    .replace(ARABIC_DIACRITICS, "")
    .replace(/[أإآٱ]/gu, "ا")
    .replace(/[ىی]/gu, "ي")
    .replace(/ؤ/gu, "و")
    .replace(/ئ/gu, "ي")
    .replace(WHITESPACE, " ")
    .trim()
    .toLocaleLowerCase("ar");
}

export function parseLocalizedSearchQuery(value: string) {
  const trimmed = value.trim();
  const quoted = trimmed.length >= 2 && trimmed.startsWith('"') && trimmed.endsWith('"');
  const exact = quoted ? trimmed.slice(1, -1) : trimmed;
  const normalized = quoted ? exact : normalizeArabicSearch(exact);
  return {
    exact,
    normalized,
    mode: quoted ? "exact" as const : "discovery" as const,
    normalizationApplied: !quoted && normalized !== exact,
  };
}
