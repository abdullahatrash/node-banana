import { generationOperationId } from "@/lib/model-routing/generation-operation";
import type { GenerationIntent } from "@/lib/model-routing/types";
import type { ContentFormat } from "./definitions";
import { contentExecutionPlan, contentProviderSourceIds, contentSourceSlotAssignment, validateContentExecutionInput } from "./content-execution-plan";
import type { ContentFormatDefinition } from "./content-format-definition";

export interface ContentAssetEvidence {
  id: string;
  type: string;
  checksum: string | null;
  width: number | null;
  height: number | null;
  durationSeconds: number | null;
  uploadState: unknown;
}

export interface ContentGenerationReference { assetId: string; intentId: string; operationId: string }

export function validateReadyPortraitAsset(asset: ContentAssetEvidence, expectedType: "image" | "video") {
  if (asset.type !== expectedType) return "CONTENT_SOURCE_TYPE_INVALID" as const;
  if (asset.uploadState !== "ready" || !/^sha256:[a-f0-9]{64}$/.test(asset.checksum ?? "")) return "CONTENT_ASSET_NOT_READY" as const;
  if (!asset.width || !asset.height || asset.width * 16 !== asset.height * 9) return "CONTENT_ASSET_9_16_REQUIRED" as const;
  if (expectedType === "video" && (!asset.durationSeconds || asset.durationSeconds < 4 || asset.durationSeconds > 60)) return "CONTENT_VIDEO_DURATION_INVALID" as const;
  return null;
}

export function isAdmittedContentArtifact(input: {
  format: ContentFormat;
  definition: ContentFormatDefinition;
  sourceAssets: ContentAssetEvidence[];
  personaState: string | null;
  generation: ContentGenerationReference;
  receipt: { assetId: string | null; intentId: string; status: string; contentDigest: string | null; width: number | null; height: number | null; durationSeconds: string | null } | null;
  intent: GenerationIntent | null;
  operation: { state: string; artifactIds: unknown } | null;
  artifact: ContentAssetEvidence | null;
}) {
  const plan = contentExecutionPlan(input.format, input.definition);
  if (plan.strategy !== "admitted_generation" || !plan.capability) return false;
  if (!validateContentExecutionInput({ format: input.format, definition: input.definition, sources: input.sourceAssets, personaState: input.personaState }).ok) return false;
  const assignment = contentSourceSlotAssignment(input.definition, input.sourceAssets);
  if (!assignment || input.sourceAssets.some((asset, index) => validateReadyPortraitAsset(asset, input.definition.sourceSlots[assignment[index]!]!.type) !== null)) return false;
  const providerSourceIds = contentProviderSourceIds(input.format, input.sourceAssets, input.definition);
  const { generation, receipt, intent, operation, artifact } = input;
  return generation.operationId === generationOperationId(generation.intentId)
    && Boolean(receipt && receipt.status === "ready" && receipt.assetId === generation.assetId && receipt.intentId === generation.intentId && receipt.contentDigest)
    && Boolean(artifact && validateReadyPortraitAsset(artifact, "video") === null && artifact.checksum === receipt?.contentDigest)
    && intent?.capability === plan.capability
    && intent.outputContract.mediaType === "video"
    && intent.outputContract.aspectRatio === "9:16"
    && intent.contentExecution?.inputArtifactIds.length === intent.rights.sourceAssetIds.length
    && intent.contentExecution.inputArtifactIds.every((id, index) => id === intent.rights.sourceAssetIds[index])
    && providerSourceIds.length === intent.contentExecution.providerInputArtifactIds.length
    && providerSourceIds.every((id, index) => id === intent.contentExecution?.providerInputArtifactIds[index])
    && operation?.state === "succeeded"
    && Array.isArray(operation.artifactIds)
    && operation.artifactIds.includes(generation.assetId);
}
