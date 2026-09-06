import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { collectBufferedAssetEvidence, collectFileAssetEvidence, collectStreamedAssetEvidence } from "../asset-media-evidence";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("asset media evidence", () => {
  it("cryptographically hashes and decodes image dimensions", async () => {
    const bytes = await sharp({ create: { width: 390, height: 693, channels: 4, background: "#ff0000" } }).png().toBuffer();
    const evidence = await collectBufferedAssetEvidence({ assetType: "image", mimeType: "image/png", bytes });
    expect(evidence).toMatchObject({ width: 390, height: 693, metadata: { dimensionEvidence: "server-media-probe/v1" } });
    expect(evidence.checksum).toMatch(/^sha256:[a-f0-9]{64}$/);
  });

  it("rejects mislabeled and undecodable image content", async () => {
    await expect(collectBufferedAssetEvidence({ assetType: "image", mimeType: "text/plain", bytes: Buffer.from("not an image") })).rejects.toThrow("ASSET_IMAGE_CONTENT_TYPE_INVALID");
    await expect(collectBufferedAssetEvidence({ assetType: "image", mimeType: "image/png", bytes: Buffer.from("not an image") })).rejects.toThrow();
  });

  it("retains a stream-computed digest while probing a quarantine file", async () => {
    const directory = await mkdtemp(join(tmpdir(), "asset-evidence-test-"));
    const path = join(directory, "image.png");
    try {
      await writeFile(path, await sharp({ create: { width: 1080, height: 1920, channels: 3, background: "#000000" } }).png().toBuffer());
      const checksum = `sha256:${"a".repeat(64)}` as const;
      await expect(collectFileAssetEvidence({ assetType: "image", mimeType: "image/png", path, checksum })).resolves.toMatchObject({ checksum, width: 1080, height: 1920 });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("streams an upload through bounded server-side hashing and media inspection", async () => {
    const bytes = await sharp({ create: { width: 720, height: 1280, channels: 3, background: "#123456" } }).png().toBuffer();
    const body = (async function* () { yield bytes.subarray(0, 100); yield bytes.subarray(100); })();
    const evidence = await collectStreamedAssetEvidence({ assetType: "image", mimeType: "image/png", body, maximumBytes: bytes.length });
    expect(evidence).toMatchObject({ sizeBytes: bytes.length, width: 720, height: 1280, metadata: { dimensionEvidence: "server-media-probe/v1" } });
    expect(evidence.checksum).toMatch(/^sha256:[a-f0-9]{64}$/);
  });

  it("stops a streamed upload once it exceeds the server limit", async () => {
    const body = (async function* () { yield new Uint8Array(6); yield new Uint8Array(6); })();
    await expect(collectStreamedAssetEvidence({ assetType: "document", mimeType: "text/plain", body, maximumBytes: 10 })).rejects.toThrow("ASSET_SIZE_LIMIT_EXCEEDED");
  });
});
