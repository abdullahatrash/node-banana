import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const component = readFileSync("src/app/inspiration/YoutubeTrendDiscovery.tsx", "utf8");
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
});
