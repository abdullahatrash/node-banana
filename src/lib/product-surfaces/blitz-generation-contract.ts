import "server-only";

import { canonicalDigest } from "@/lib/agent-tools/canonical";
import { brandAwareRemixBriefSchema, blitzPayloadSchema, type BrandAwareRemixBrief } from "./definitions";

type RequestContract = {
  prompt: string;
  capability: string;
  contentLanguage: string;
  arabicVariety: string | null;
  sourceAssetIds: string[];
  rightsBasis: string;
  permittedRemix: string;
  rightsEvidenceIds: string[];
  remixBrief: { preserve: string[]; transform: string[]; avoid: string[] };
};

export type BlitzGenerationContractResult =
  | { ok: true; brief: BrandAwareRemixBrief }
  | { ok: false; code: "BLITZ_BRIEF_SNAPSHOT_REQUIRED" | "BLITZ_GENERATION_CONTRACT_MISMATCH" };

/** Ensures a billable generation request is exactly the immutable proposal the server queued. */
export function validateBrandAwareBlitzGenerationContract(input: {
  payloadValue: unknown;
  request: RequestContract;
  brand: { id: string; revision: number; digest: string; acceptedAt: Date };
}): BlitzGenerationContractResult {
  const payloadResult = blitzPayloadSchema.safeParse(input.payloadValue);
  if (!payloadResult.success) return { ok: false, code: "BLITZ_BRIEF_SNAPSHOT_REQUIRED" };
  const payload = payloadResult.data;
  const briefResult = brandAwareRemixBriefSchema.safeParse(payload.remixBrief);
  if (!briefResult.success || !payload.inspirationItemId || !payload.contentLanguage) return { ok: false, code: "BLITZ_BRIEF_SNAPSHOT_REQUIRED" };
  const brief = briefResult.data;
  const common = input.request.prompt === brief.provider.prompt
    && canonicalDigest(input.request.remixBrief) === canonicalDigest({ preserve: brief.provider.preserve, transform: brief.provider.transform, avoid: brief.provider.avoid })
    && input.request.contentLanguage === payload.contentLanguage
    && input.request.arabicVariety === payload.arabicVariety
    && brief.source.inspirationItemId === payload.inspirationItemId
    && brief.brandProfile.id === input.brand.id
    && brief.brandProfile.revision === input.brand.revision
    && brief.brandProfile.digest === input.brand.digest
    && brief.brandProfile.acceptedAt === input.brand.acceptedAt.toISOString();
  const mediaExact = payload.sourceUsage === "media_remix"
    && brief.schema === "brand-aware-remix-brief/v1"
    && Boolean(payload.sourceAssetId && payload.sourceMediaType && payload.rightsSnapshot && payload.rightsBasis && payload.permittedRemix)
    && canonicalDigest(input.request.sourceAssetIds) === canonicalDigest([payload.sourceAssetId])
    && input.request.rightsBasis === payload.rightsBasis
    && input.request.permittedRemix === payload.permittedRemix
    && canonicalDigest(input.request.rightsEvidenceIds) === canonicalDigest(payload.rightsEvidenceIds)
    && input.request.capability === (payload.sourceMediaType === "video" ? "video_to_video" : "image_to_video")
    && brief.source.rightsSnapshotDigest === payload.rightsSnapshot?.digest;
  const metadataExact = payload.sourceUsage === "metadata_topic_only"
    && brief.schema === "brand-aware-remix-brief/v2"
    && brief.source.usage === "metadata_topic_only"
    && brief.source.rightsSnapshotDigest === null
    && !payload.sourceAssetId
    && !payload.sourceMediaType
    && !payload.rightsSnapshot
    && !payload.rightsBasis
    && !payload.permittedRemix
    && input.request.sourceAssetIds.length === 0
    && input.request.rightsBasis === "owned"
    && input.request.permittedRemix === "reference_only"
    && input.request.rightsEvidenceIds.length === 0
    && input.request.remixBrief.transform.length === 0
    && input.request.capability === "text_to_video";
  const exact = common && (mediaExact || metadataExact);
  return exact ? { ok: true, brief } : { ok: false, code: "BLITZ_GENERATION_CONTRACT_MISMATCH" };
}
