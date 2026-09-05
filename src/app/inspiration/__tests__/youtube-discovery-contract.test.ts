import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const component = readFileSync("src/app/inspiration/YoutubeTrendDiscovery.tsx", "utf8");
const rtlSmoke = readFileSync("scripts/smoke-rtl-visual.mjs", "utf8");
const en = JSON.parse(readFileSync("src/i18n/messages/en.json", "utf8"));
const ar = JSON.parse(readFileSync("src/i18n/messages/ar.json", "utf8"));

describe("YouTube discovery presentation", () => {
  it("ships Arabic parity, direction-safe content, attribution, and no remix handoff", () => {
    expect(Object.keys(ar.product.inspiration.youtube)).toEqual(Object.keys(en.product.inspiration.youtube));
    expect(component).toContain('dir="auto"');
    expect(component).toContain("strict-origin-when-cross-origin");
    expect(component).toContain("https://www.youtube.com/t/terms");
    expect(component).toContain("https://policies.google.com/privacy");
    expect(component).not.toContain("BookmarkPlus");
    expect(component).not.toContain('productRequest("/api/product-inspiration",');
  });

  it("isolates operator configuration identifiers from Arabic prose", () => {
    const checks = ar.product.inspiration.youtube.checks as Record<string, string>;
    expect(Object.values(checks).join(" ")).toContain("YOUTUBE_TREND_DISCOVERY_ENABLED=true")
    expect(component).toContain("function SetupCheck")
    expect(component).toContain('<code dir="ltr"')
    expect(component).toContain('["NEXT_PUBLIC_TERMS_URL", "NEXT_PUBLIC_PRIVACY_URL"]')
    expect(rtlSmoke).toContain("bidiIsolationOffenders")
    expect(rtlSmoke).toContain("unisolated technical identifiers")
  });
});
