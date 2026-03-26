import type { SocialPlatform } from "@/lib/db/schema";
import type { PublishMediaItem } from "@/lib/social/provider-interface";

/**
 * Per-platform media constraints.
 * Used for validation before upload and for processing (resize/format).
 */
export interface MediaConstraints {
  maxImageWidth: number;
  imageFormat: "jpeg" | "png" | "webp";
  imageQuality: number;
  maxImages: number;
  maxVideos: number;
  requirePublicUrl: boolean;
}

export const PLATFORM_MEDIA_CONSTRAINTS: Record<SocialPlatform, MediaConstraints> = {
  x: {
    maxImageWidth: 1000,
    imageFormat: "jpeg",
    imageQuality: 85,
    maxImages: 4,
    maxVideos: 1,
    requirePublicUrl: false,
  },
  linkedin: {
    maxImageWidth: 1000,
    imageFormat: "jpeg",
    imageQuality: 85,
    maxImages: 9,
    maxVideos: 1,
    requirePublicUrl: false,
  },
  instagram: {
    maxImageWidth: 1920,
    imageFormat: "jpeg",
    imageQuality: 90,
    maxImages: 10,
    maxVideos: 1,
    requirePublicUrl: true,
  },
  tiktok: {
    maxImageWidth: 1080,
    imageFormat: "jpeg",
    imageQuality: 90,
    maxImages: 35,
    maxVideos: 1,
    requirePublicUrl: true,
  },
  facebook: {
    maxImageWidth: 2048,
    imageFormat: "jpeg",
    imageQuality: 90,
    maxImages: 10,
    maxVideos: 1,
    requirePublicUrl: true,
  },
  youtube: {
    maxImageWidth: 0,
    imageFormat: "jpeg",
    imageQuality: 0,
    maxImages: 0,
    maxVideos: 1,
    requirePublicUrl: false,
  },
};

export interface MediaValidationResult {
  valid: boolean;
  errors: string[];
}

/**
 * Validate media items against a platform's constraints.
 * Call this before attempting to publish.
 */
export function validateMediaConstraints(
  platform: SocialPlatform,
  media: PublishMediaItem[],
): MediaValidationResult {
  const constraints = PLATFORM_MEDIA_CONSTRAINTS[platform];
  const errors: string[] = [];

  const images = media.filter((m) => m.type === "image");
  const videos = media.filter((m) => m.type === "video");

  // YouTube is video-only — check before generic max images
  if (platform === "youtube" && images.length > 0) {
    errors.push("YouTube only supports video uploads, not images.");
  } else if (images.length > constraints.maxImages) {
    errors.push(
      `${platform} supports max ${constraints.maxImages} images, got ${images.length}.`,
    );
  }

  if (videos.length > constraints.maxVideos) {
    errors.push(
      `${platform} supports max ${constraints.maxVideos} video(s), got ${videos.length}.`,
    );
  }

  // Can't mix images and videos on most platforms
  if (images.length > 0 && videos.length > 0 && platform !== "facebook") {
    errors.push(
      `${platform} does not support mixing images and videos in one post.`,
    );
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Resize an image buffer to fit within a maximum width.
 * Uses sharp for format conversion and quality control.
 */
export async function resizeImage(
  buffer: Buffer,
  maxWidth: number,
  format: "jpeg" | "png" | "webp" = "jpeg",
  quality: number = 85,
): Promise<Buffer> {
  const sharp = (await import("sharp")).default;

  let pipeline = sharp(buffer);

  // Only resize if maxWidth > 0 (YouTube has 0 = no image processing)
  if (maxWidth > 0) {
    const metadata = await sharp(buffer).metadata();
    if (metadata.width && metadata.width > maxWidth) {
      pipeline = pipeline.resize({ width: maxWidth, withoutEnlargement: true });
    }
  }

  if (format === "jpeg") {
    pipeline = pipeline.jpeg({ quality });
  } else if (format === "png") {
    pipeline = pipeline.png({ quality });
  } else if (format === "webp") {
    pipeline = pipeline.webp({ quality });
  }

  return pipeline.toBuffer();
}

/**
 * Download a URL to a Buffer.
 * Used by providers that require binary upload (e.g., X/Twitter).
 */
export async function downloadToBuffer(
  url: string,
): Promise<{ buffer: Buffer; mimeType: string }> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(
      `Failed to download media: ${response.status} ${response.statusText}`,
    );
  }

  const mimeType = response.headers.get("content-type") || "application/octet-stream";
  const arrayBuffer = await response.arrayBuffer();
  return { buffer: Buffer.from(arrayBuffer), mimeType };
}

export interface ProcessedMedia {
  type: "image" | "video";
  buffer?: Buffer;
  url: string;
  mimeType: string;
  alt?: string;
}

/**
 * Process media items for a specific platform:
 * - Validate constraints
 * - Download and resize images as needed
 * - Return processed media ready for the provider's post() method
 */
export async function processMediaForPlatform(
  platform: SocialPlatform,
  media: PublishMediaItem[],
): Promise<ProcessedMedia[]> {
  const constraints = PLATFORM_MEDIA_CONSTRAINTS[platform];
  const validation = validateMediaConstraints(platform, media);
  if (!validation.valid) {
    throw new MediaConstraintError(platform, validation.errors);
  }

  const processed: ProcessedMedia[] = [];

  for (const item of media) {
    if (item.type === "video") {
      // Videos are passed through as-is (URL-based upload for most platforms)
      processed.push({
        type: "video",
        url: item.url,
        mimeType: item.mimeType || "video/mp4",
        alt: item.alt,
      });
      continue;
    }

    // For images: download → resize → format convert
    if (constraints.maxImageWidth > 0) {
      const { buffer, mimeType } = await downloadToBuffer(item.url);
      const resized = await resizeImage(
        buffer,
        constraints.maxImageWidth,
        constraints.imageFormat,
        constraints.imageQuality,
      );

      processed.push({
        type: "image",
        buffer: resized,
        url: item.url,
        mimeType: `image/${constraints.imageFormat}`,
        alt: item.alt,
      });
    } else {
      // Platform doesn't process images (e.g., YouTube)
      processed.push({
        type: "image",
        url: item.url,
        mimeType: item.mimeType || "image/jpeg",
        alt: item.alt,
      });
    }
  }

  return processed;
}

export class MediaConstraintError extends Error {
  platform: string;
  violations: string[];

  constructor(platform: string, violations: string[]) {
    super(`Media constraints violated for ${platform}: ${violations.join("; ")}`);
    this.name = "MediaConstraintError";
    this.platform = platform;
    this.violations = violations;
  }
}
