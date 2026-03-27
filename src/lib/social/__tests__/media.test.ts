import { describe, expect, it, vi } from "vitest";
import {
  MediaConstraintError,
  PLATFORM_MEDIA_CONSTRAINTS,
  resizeImage,
  validateMediaConstraints,
} from "@/lib/social/media";
import type { PublishMediaItem } from "@/lib/social/provider-interface";

function makeImage(url = "https://example.com/img.jpg"): PublishMediaItem {
  return { type: "image", url };
}

function makeVideo(url = "https://example.com/vid.mp4"): PublishMediaItem {
  return { type: "video", url };
}

describe("social/media", () => {
  describe("PLATFORM_MEDIA_CONSTRAINTS", () => {
    it("defines constraints for all supported social platforms", () => {
      const platforms = [
        "x",
        "linkedin",
        "instagram",
        "tiktok",
        "threads",
        "pinterest",
        "reddit",
        "facebook",
        "youtube",
      ] as const;
      for (const platform of platforms) {
        expect(PLATFORM_MEDIA_CONSTRAINTS[platform]).toBeDefined();
        expect(PLATFORM_MEDIA_CONSTRAINTS[platform].maxImages).toBeTypeOf("number");
        expect(PLATFORM_MEDIA_CONSTRAINTS[platform].maxVideos).toBeTypeOf("number");
      }
    });
  });

  describe("validateMediaConstraints", () => {
    it("passes for valid single image on X", () => {
      const result = validateMediaConstraints("x", [makeImage()]);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it("passes for empty media", () => {
      const result = validateMediaConstraints("x", []);
      expect(result.valid).toBe(true);
    });

    it("rejects too many images on X (max 4)", () => {
      const media = Array.from({ length: 5 }, () => makeImage());
      const result = validateMediaConstraints("x", media);
      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain("max 4 images");
    });

    it("rejects too many images on LinkedIn (max 9)", () => {
      const media = Array.from({ length: 10 }, () => makeImage());
      const result = validateMediaConstraints("linkedin", media);
      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain("max 9 images");
    });

    it("passes 10 images on Instagram", () => {
      const media = Array.from({ length: 10 }, () => makeImage());
      const result = validateMediaConstraints("instagram", media);
      expect(result.valid).toBe(true);
    });

    it("rejects 11 images on Instagram", () => {
      const media = Array.from({ length: 11 }, () => makeImage());
      const result = validateMediaConstraints("instagram", media);
      expect(result.valid).toBe(false);
    });

    it("rejects images on YouTube", () => {
      const result = validateMediaConstraints("youtube", [makeImage()]);
      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain("video uploads, not images");
    });

    it("allows video on YouTube", () => {
      const result = validateMediaConstraints("youtube", [makeVideo()]);
      expect(result.valid).toBe(true);
    });

    it("rejects mixing images and videos on X", () => {
      const result = validateMediaConstraints("x", [makeImage(), makeVideo()]);
      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain("mixing images and videos");
    });

    it("rejects multiple videos", () => {
      const result = validateMediaConstraints("x", [makeVideo(), makeVideo()]);
      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain("max 1 video");
    });

    it("returns multiple errors at once", () => {
      // 5 images + 2 videos on X (max 4 images, max 1 video, no mixing)
      const media = [
        ...Array.from({ length: 5 }, () => makeImage()),
        makeVideo(),
        makeVideo(),
      ];
      const result = validateMediaConstraints("x", media);
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe("resizeImage", () => {
    it("resizes a large image to maxWidth", async () => {
      const sharp = (await import("sharp")).default;
      // Create a 2000x1000 test image
      const input = await sharp({
        create: { width: 2000, height: 1000, channels: 3, background: { r: 255, g: 0, b: 0 } },
      })
        .jpeg()
        .toBuffer();

      const result = await resizeImage(input, 1000, "jpeg", 85);
      const metadata = await sharp(result).metadata();
      expect(metadata.width).toBe(1000);
      expect(metadata.height).toBe(500);
      expect(metadata.format).toBe("jpeg");
    });

    it("does not enlarge small images", async () => {
      const sharp = (await import("sharp")).default;
      const input = await sharp({
        create: { width: 500, height: 250, channels: 3, background: { r: 0, g: 255, b: 0 } },
      })
        .jpeg()
        .toBuffer();

      const result = await resizeImage(input, 1000, "jpeg", 85);
      const metadata = await sharp(result).metadata();
      expect(metadata.width).toBe(500);
    });

    it("converts to the requested format", async () => {
      const sharp = (await import("sharp")).default;
      const input = await sharp({
        create: { width: 100, height: 100, channels: 3, background: { r: 0, g: 0, b: 255 } },
      })
        .png()
        .toBuffer();

      const result = await resizeImage(input, 1000, "webp", 80);
      const metadata = await sharp(result).metadata();
      expect(metadata.format).toBe("webp");
    });
  });

  describe("MediaConstraintError", () => {
    it("includes platform and violations", () => {
      const error = new MediaConstraintError("x", ["too many images", "no video"]);
      expect(error.name).toBe("MediaConstraintError");
      expect(error.platform).toBe("x");
      expect(error.violations).toEqual(["too many images", "no video"]);
      expect(error.message).toContain("x");
      expect(error.message).toContain("too many images");
    });
  });
});
