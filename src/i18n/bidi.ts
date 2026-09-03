const LTR_ISOLATE = "\u2066";
const RTL_ISOLATE = "\u2067";
const POP_DIRECTIONAL_ISOLATE = "\u2069";
const FIRST_STRONG_ISOLATE = "\u2068";

export function isolateLtr(value: string) {
  return `${LTR_ISOLATE}${value}${POP_DIRECTIONAL_ISOLATE}`;
}

export function isolateRtl(value: string) {
  return `${RTL_ISOLATE}${value}${POP_DIRECTIONAL_ISOLATE}`;
}

export function isolateAuto(value: string) {
  return `${FIRST_STRONG_ISOLATE}${value}${POP_DIRECTIONAL_ISOLATE}`;
}

export function directionForText(value: string): "rtl" | "ltr" | "auto" {
  const firstStrong = value.match(/[A-Za-z\u0590-\u08ff]/u)?.[0];
  if (!firstStrong) return "auto";
  return /[\u0590-\u08ff]/u.test(firstStrong) ? "rtl" : "ltr";
}
