import type { GenerationCapability } from "./types";

export interface CanonicalGenerationSource {
  id: string;
  type: string;
  storageKey: string;
  checksum: string | null;
  width: number | null;
  height: number | null;
  metadata: Record<string, unknown> | null;
}

export type SourceValidationResult = { ok: true } | { ok: false; code: "SOURCE_ASSET_NOT_READY" | "SOURCE_MEDIA_TYPE_MISMATCH" | "SOURCE_DECODED_DIMENSIONS_REQUIRED" | "SOURCE_9_16_REQUIRED" };

/** Paid image-to-video work accepts only canonical, server-decoded 9:16 inputs. */
export function validateGenerationSources(capability: GenerationCapability, expectedIds: string[], sources: CanonicalGenerationSource[]): SourceValidationResult {
  if (sources.length !== expectedIds.length || sources.some((source) => source.metadata?.uploadState !== "ready" || !source.storageKey || !/^sha256:[a-f0-9]{64}$/.test(source.checksum ?? ""))) return { ok: false, code: "SOURCE_ASSET_NOT_READY" };
  if (capability !== "image_to_video") return { ok: true };
  if (expectedIds.length !== 1 || sources.some((source) => source.type !== "image")) return { ok: false, code: "SOURCE_MEDIA_TYPE_MISMATCH" };
  const source = sources[0]!;
  if (!source.width || !source.height || source.metadata?.dimensionEvidence !== "server-media-probe/v1") return { ok: false, code: "SOURCE_DECODED_DIMENSIONS_REQUIRED" };
  return source.width * 16 === source.height * 9 ? { ok: true } : { ok: false, code: "SOURCE_9_16_REQUIRED" };
}
