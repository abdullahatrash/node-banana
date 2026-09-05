import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const component = readFileSync("src/app/inspiration/YoutubeTrendDiscovery.tsx", "utf8");
const rtlSmoke = readFileSync("scripts/smoke-rtl-visual.mjs", "utf8");
const en = JSON.parse(readFileSync("src/i18n/messages/en.json", "utf8"));
const ar = JSON.parse(readFileSync("src/i18n/messages/ar.json", "utf8"));

describe("YouTube discovery presentation", () => {
  it("ships Arabic parity, direction-safe attribution, and an explicit metadata-only handoff", () => {
    expect(Object.keys(ar.product.inspiration.youtube)).toEqual(Object.keys(en.product.inspiration.youtube));
    expect(ar.product.inspiration.youtubeRemix).toEqual(expect.objectContaining({ createOriginal: expect.any(String) }));
    expect(Object.keys(ar.product.inspiration.youtubeRemix)).toEqual(Object.keys(en.product.inspiration.youtubeRemix));
    expect(Object.keys(ar.product.inspiration.youtubeQueue)).toEqual(Object.keys(en.product.inspiration.youtubeQueue));
    expect(component).toContain('dir="auto"');
    expect(component).toContain("strict-origin-when-cross-origin");
    expect(component).toContain("https://www.youtube.com/t/terms");
    expect(component).toContain("https://policies.google.com/privacy");
    expect(component).toContain("BookmarkPlus");
    expect(component).toContain('productRequest("/api/product-inspiration/youtube/queue"');
    expect(component).toContain("sourceId: entry.sourceId, videoId: entry.videoId, contentLanguage");
    expect(component).not.toContain("thumbnailUrl: entry.thumbnailUrl");
    expect(en.product.inspiration.youtubeRemix.separation).toContain("no video, thumbnail, audio, transcript, or creator identity");
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
