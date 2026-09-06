const substitutions: Record<string, string> = {
  a: "à", b: "ƀ", c: "ç", d: "ð", e: "ë", f: "ƒ", g: "ğ", h: "ħ", i: "ï",
  j: "ĵ", k: "ķ", l: "ļ", m: "ɱ", n: "ñ", o: "ô", p: "þ", q: "ɋ", r: "ř",
  s: "š", t: "ŧ", u: "ü", v: "ṽ", w: "ŵ", x: "ẋ", y: "ÿ", z: "ž",
};

/** Expands rendered copy for clipping/layout tests without changing runtime locales. */
export function pseudoLocalize(text: string): string {
  let transformed = "";
  for (const character of text) {
    const lower = character.toLowerCase();
    const replacement = substitutions[lower];
    if (!replacement) {
      transformed += character;
      continue;
    }
    const localized = character === lower ? replacement : replacement.toUpperCase();
    transformed += "aeiou".includes(lower) ? `${localized}${localized}` : localized;
  }
  return `［!! ${transformed} !!］`;
}
