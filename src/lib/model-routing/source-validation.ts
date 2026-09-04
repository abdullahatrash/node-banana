import type { GenerationCapability } from "./types";

export interface CanonicalGenerationSource {
  id: string;
  type: string;
  storageKey: string;
  checksum: string | null;
  mimeType: string | null;
  width: number | null;
  height: number | null;
  durationSeconds: number | null;
  metadata: Record<string, unknown> | null;
}

export type SourceValidationResult = { ok: true } | { ok: false; code: "SOURCE_ASSET_NOT_READY" | "SOURCE_MEDIA_TYPE_MISMATCH" | "SOURCE_DECODED_DIMENSIONS_REQUIRED" | "SOURCE_9_16_REQUIRED" | "SOURCE_CARDINALITY_INVALID" | "SOURCE_ASSET_DUPLICATE" | "SOURCE_VIDEO_FORMAT_UNSUPPORTED" | "SOURCE_VIDEO_DURATION_INVALID" };

/** Capability-specific source contract enforced before any paid provider call. */
export function validateGenerationSources(capability: GenerationCapability, expectedIds: string[], sources: CanonicalGenerationSource[], imageMode: "single" | "array" = "single"): SourceValidationResult {
  if (new Set(expectedIds).size !== expectedIds.length) return { ok: false, code: "SOURCE_ASSET_DUPLICATE" };
  if (sources.length !== expectedIds.length || sources.some((source) => source.metadata?.uploadState !== "ready" || !source.storageKey || !/^sha256:[a-f0-9]{64}$/.test(source.checksum ?? ""))) return { ok: false, code: "SOURCE_ASSET_NOT_READY" };
  if (capability === "text_generation" || capability === "text_to_image" || capability === "text_to_video") return expectedIds.length === 0 ? { ok: true } : { ok: false, code: "SOURCE_CARDINALITY_INVALID" };
  if (capability === "image_to_image" && (expectedIds.length < 1 || (imageMode === "single" && expectedIds.length !== 1))) return { ok: false, code: "SOURCE_CARDINALITY_INVALID" };
  if (capability === "image_to_video" && (expectedIds.length < 1 || (imageMode === "single" && expectedIds.length !== 1))) return { ok: false, code: "SOURCE_CARDINALITY_INVALID" };
  if (capability === "video_to_video" && expectedIds.length !== 1) return { ok: false, code: "SOURCE_CARDINALITY_INVALID" };
  const expectedType = capability === "video_to_video" ? "video" : "image";
  if (sources.some((source) => source.type !== expectedType)) return { ok: false, code: "SOURCE_MEDIA_TYPE_MISMATCH" };
  if (capability === "image_to_image") return { ok: true };
  if (sources.some((source) => !source.width || !source.height || source.metadata?.dimensionEvidence !== "server-media-probe/v1")) return { ok: false, code: "SOURCE_DECODED_DIMENSIONS_REQUIRED" };
  if (sources.some((source) => source.width! * 16 !== source.height! * 9)) return { ok: false, code: "SOURCE_9_16_REQUIRED" };
  const source = sources[0]!;
  if (capability === "video_to_video") {
    if (!source.mimeType || !["video/mp4", "video/webm", "video/quicktime"].includes(source.mimeType)) return { ok: false, code: "SOURCE_VIDEO_FORMAT_UNSUPPORTED" };
    if (!source.durationSeconds || !Number.isFinite(source.durationSeconds) || source.durationSeconds <= 0 || source.durationSeconds > 60) return { ok: false, code: "SOURCE_VIDEO_DURATION_INVALID" };
  }
  return { ok: true };
}
