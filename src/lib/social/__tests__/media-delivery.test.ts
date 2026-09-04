import { describe, expect, it, vi } from "vitest";
import {
  SocialMediaDeliveryIntegrityError,
  verifyAndResolveSocialMediaDelivery,
} from "../media-delivery";

const bytes = Buffer.from("owned image bytes");
const digest = "sha256:66467908921a451234087702f2b21795f3cf67dc89c4021f58fe4073499d44bb";
const references = [{ resourceKind: "studio_asset" as const, assetId: "asset-1", assetDigest: digest, order: 0, alt: "Accessible alt" }];
const resources = new Map([
  ["studio_asset:asset-1", { resourceKind: "studio_asset" as const, id: "asset-1", digest, type: "image" as const, storageKey: "workspace/asset-1.png" }],
]);

function dependencies(body = bytes) {
  return {
    openObject: vi.fn(async () => ({ body: (async function* () { yield body; })(), contentType: "image/png", versionId: "v1", etag: "etag", contentLength: body.length })),
    signObject: vi.fn(async ({ key }: { key: string }) => ({ key, downloadUrl: `https://owned.invalid/${key}?fresh=1`, expiresInSeconds: 900 })),
  };
}

describe("verified social media delivery", () => {
  it("hashes owned bytes and mints a fresh URL in canonical order", async () => {
    const deps = dependencies();
    await expect(verifyAndResolveSocialMediaDelivery({ references, resources }, deps)).resolves.toEqual([
      { type: "image", url: "https://owned.invalid/workspace/asset-1.png?fresh=1", mimeType: "image/png", alt: "Accessible alt" },
    ]);
    expect(deps.openObject).toHaveBeenCalledWith({ key: "workspace/asset-1.png" });
    expect(deps.signObject).toHaveBeenCalledAfter(deps.openObject);
  });

  it("fails closed for missing resources, malformed ordering, or changed bytes", async () => {
    await expect(verifyAndResolveSocialMediaDelivery({ references, resources: new Map() }, dependencies())).rejects.toBeInstanceOf(SocialMediaDeliveryIntegrityError);
    await expect(verifyAndResolveSocialMediaDelivery({ references: [{ ...references[0], order: 1 }], resources }, dependencies())).rejects.toThrow("contiguous canonical order");
    await expect(verifyAndResolveSocialMediaDelivery({ references, resources }, dependencies(Buffer.from("tampered")))).rejects.toThrow("do not match");
  });

  it("rejects metadata-only and stale digest bindings before reading storage", async () => {
    const deps = dependencies();
    const missingDigestResources = new Map([["studio_asset:asset-1", { ...resources.get("studio_asset:asset-1")!, digest: "metadata-fallback" }]]);
    await expect(verifyAndResolveSocialMediaDelivery({ references, resources: missingDigestResources }, deps)).rejects.toThrow("digest no longer matches");
    expect(deps.openObject).not.toHaveBeenCalled();
  });
});
