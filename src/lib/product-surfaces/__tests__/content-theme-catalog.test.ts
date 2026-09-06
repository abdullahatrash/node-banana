import { describe, expect, it } from "vitest";
import { canonicalDigest } from "@/lib/agent-tools/canonical";
import { CURATED_CONTENT_THEMES, CURATED_THEME_LICENSE_ID, CURATED_THEME_LIMIT, isCuratedContentThemeLicenseEvidence } from "../content-theme-catalog";

describe("curated Content Theme catalog", () => {
  it("contains fifty distinct immutable first-party themes with authored Arabic", () => {
    expect(CURATED_CONTENT_THEMES).toHaveLength(CURATED_THEME_LIMIT);
    expect(new Set(CURATED_CONTENT_THEMES.map((theme) => theme.id)).size).toBe(CURATED_THEME_LIMIT);
    expect(new Set(CURATED_CONTENT_THEMES.map((theme) => theme.digest)).size).toBe(CURATED_THEME_LIMIT);
    for (const theme of CURATED_CONTENT_THEMES) {
      expect(theme.authoredName.ar).toMatch(/[\u0600-\u06ff]/);
      expect(theme.document.captions).toMatchObject({ bidi: "native", fontFamilies: expect.arrayContaining(["Noto Sans Arabic"]) });
      expect(theme.digest).toBe(canonicalDigest(theme.document));
      expect(theme.licenseEvidenceIds).toEqual([CURATED_THEME_LICENSE_ID]);
    }
  });

  it("binds its license identifier to the exact curated theme revision and digest", () => {
    const theme = CURATED_CONTENT_THEMES[0]!;
    const valid = { themeId: `curated-theme:${theme.id}`, revision: theme.revision, digest: theme.digest, evidenceId: CURATED_THEME_LICENSE_ID };
    expect(isCuratedContentThemeLicenseEvidence(valid)).toBe(true);
    expect(isCuratedContentThemeLicenseEvidence({ ...valid, themeId: "custom-theme" })).toBe(false);
    expect(isCuratedContentThemeLicenseEvidence({ ...valid, digest: `sha256:${"f".repeat(64)}` })).toBe(false);
    expect(isCuratedContentThemeLicenseEvidence({ ...valid, evidenceId: "curated-theme-license:v2:unknown" })).toBe(false);
  });
});
