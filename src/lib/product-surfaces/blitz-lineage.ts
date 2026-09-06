import { generationOperationId } from "@/lib/model-routing/generation-operation";
import type { GenerationIntent } from "@/lib/model-routing/types";

export function isAdmittedBlitzArtifact(input: {
  sourceAssetId: string;
  rightsDigest: string;
  remixBriefDigest: string;
  generation: { assetId: string; intentId: string; operationId: string };
  receipt: { assetId: string | null; intentId: string; status: string; contentDigest: string | null } | null;
  intent: GenerationIntent | null;
  operation: { state: string; artifactIds: unknown } | null;
  artifactExists: boolean;
}) {
  const { generation, receipt, intent, operation } = input;
  return generation.operationId === generationOperationId(generation.intentId)
    && Boolean(receipt && receipt.status === "ready" && receipt.assetId === generation.assetId && receipt.intentId === generation.intentId && receipt.contentDigest)
    && input.artifactExists
    && intent?.outputContract.mediaType === "video"
    && intent.outputContract.aspectRatio === "9:16"
    && intent.rights.digest === input.rightsDigest
    && intent.remixBrief.digest === input.remixBriefDigest
    && intent.rights.sourceAssetIds.length === 1
    && intent.rights.sourceAssetIds[0] === input.sourceAssetId
    && operation?.state === "succeeded"
    && Array.isArray(operation.artifactIds)
    && operation.artifactIds.includes(generation.assetId);
}

export function isAdmittedMetadataBlitzArtifact(input: {
  remixBriefDigest: string;
  generation: { assetId: string; intentId: string; operationId: string };
  receipt: { assetId: string | null; intentId: string; status: string; contentDigest: string | null } | null;
  intent: GenerationIntent | null;
  operation: { state: string; artifactIds: unknown } | null;
  artifactExists: boolean;
}) {
  const { generation, receipt, intent, operation } = input;
  return generation.operationId === generationOperationId(generation.intentId)
    && Boolean(receipt && receipt.status === "ready" && receipt.assetId === generation.assetId && receipt.intentId === generation.intentId && receipt.contentDigest)
    && input.artifactExists
    && intent?.capability === "text_to_video"
    && intent.outputContract.mediaType === "video"
    && intent.outputContract.aspectRatio === "9:16"
    && intent.rights.sourceAssetIds.length === 0
    && intent.rights.evidence.length === 0
    && intent.providerComposition.sourceAssetIds.length === 0
    && intent.remixBrief.digest === input.remixBriefDigest
    && intent.remixBrief.transform.length === 0
    && operation?.state === "succeeded"
    && Array.isArray(operation.artifactIds)
    && operation.artifactIds.includes(generation.assetId);
}
