import { describe, expect, it } from "vitest";
import { canonicalDigest } from "@/lib/agent-tools/canonical";
import { compileThemeInstructions, mediaSetMembershipDigest, orderedContentAssetIds, resolveMediaSetRevision, resolveThemeRevision } from "../content-execution-resources";

const digest = (value: unknown) => canonicalDigest(value) as `sha256:${string}`;
const themeDocument = { schema: "content-theme/v1" as const, visual: { stylePrompt: "Warm editorial light", palette: ["#112233"], avoid: ["unlicensed marks"] }, captions: { style: "brand", fontFamilies: ["Noto Sans Arabic"], position: "bottom" as const, bidi: "native" as const } };

describe("Content execution resource revisions", () => {
  it("pins ordered Media Set membership and detects later membership mutation", () => {
    const reference = { mediaSetId: "set-1", revision: 2, digest: mediaSetMembershipDigest({ mediaSetId: "set-1", revision: 2, orderedAssetIds: ["asset-b", "asset-a"] }) };
    const resolved = resolveMediaSetRevision({ workspaceId: "ws-a", reference, snapshot: { workspaceId: "ws-a", recordId: "set-1", revision: 2, state: "active", payload: { assetIds: ["asset-b", "asset-a"] } } });
    expect(resolved.orderedAssetIds).toEqual(["asset-b", "asset-a"]);
    expect(orderedContentAssetIds(["asset-direct", "asset-b"], [resolved])).toEqual(["asset-direct", "asset-b", "asset-a"]);
    expect(() => resolveMediaSetRevision({ workspaceId: "ws-a", reference, snapshot: { workspaceId: "ws-a", recordId: "set-1", revision: 2, state: "active", payload: { assetIds: ["asset-a", "asset-b"] } } })).toThrow("CONTENT_MEDIA_SET_REVISION_STALE");
  });

  it("rejects cross-tenant Media Set snapshots", () => {
    const reference = { mediaSetId: "set-1", revision: 1, digest: mediaSetMembershipDigest({ mediaSetId: "set-1", revision: 1, orderedAssetIds: ["asset-a"] }) };
    expect(() => resolveMediaSetRevision({ workspaceId: "ws-a", reference, snapshot: { workspaceId: "ws-b", recordId: "set-1", revision: 1, state: "active", payload: { assetIds: ["asset-a"] } } })).toThrow("CONTENT_MEDIA_SET_REVISION_INVALID");
  });

  it("pins licensed Theme documents and compiles exact visual/caption instructions", () => {
    const reference = { themeId: "theme-1", revision: 4, digest: digest(themeDocument) };
    const theme = resolveThemeRevision({ workspaceId: "ws-a", reference, row: { workspaceId: "ws-a", themeId: "theme-1", revision: 4, state: "active", document: themeDocument, documentDigest: reference.digest, licenseEvidenceIds: ["license-1"], licenseExpiresAt: null } });
    expect(compileThemeInstructions([theme])).toEqual([{ themeId: "theme-1", revision: 4, digest: reference.digest, visual: themeDocument.visual, captions: themeDocument.captions, licenseEvidenceIds: ["license-1"] }]);
    expect(() => resolveThemeRevision({ workspaceId: "ws-a", reference: { ...reference, digest: digest({ altered: true }) }, row: { workspaceId: "ws-a", themeId: "theme-1", revision: 4, state: "active", document: themeDocument, documentDigest: reference.digest, licenseEvidenceIds: ["license-1"], licenseExpiresAt: null } })).toThrow("CONTENT_THEME_REVISION_STALE");
  });
});
