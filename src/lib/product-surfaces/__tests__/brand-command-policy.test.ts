import { describe, expect, it } from "vitest";
import {
  brandCommandRequestDigest,
  brandReceiptRevision,
  draftFollowsActiveBrandLineage,
} from "../brand-command-policy";

describe("Brand command policy", () => {
  it("binds command replay identity to the Workspace", () => {
    const facts = { profileId: "brand", expectedRevision: 2 };
    expect(brandCommandRequestDigest({ workspaceId: "workspace-a", action: "activate", facts }))
      .not.toBe(brandCommandRequestDigest({ workspaceId: "workspace-b", action: "activate", facts }));
  });

  it("accepts only positive durable revisions for legacy receipt storage", () => {
    expect(brandReceiptRevision(3)).toBe(3);
    expect(() => brandReceiptRevision(0)).toThrow("BRAND_RECEIPT_REVISION_INVALID");
  });

  it("prevents a draft from superseding a different active lineage", () => {
    expect(draftFollowsActiveBrandLineage({ draftSourceProfileId: "active", activeProfileId: "active" })).toBe(true);
    expect(draftFollowsActiveBrandLineage({ draftSourceProfileId: "old", activeProfileId: "active" })).toBe(false);
  });
});
