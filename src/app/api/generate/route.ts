/**
 * Generate API Route
 * 
 * TIMEOUT CONFIGURATION:
 * - maxDuration: Only applies on Vercel, not locally
 * - AbortSignal.timeout: Controls outgoing fetch to providers
 * - For local development, server.requestTimeout must be set in server.js (Node.js default is 5 minutes)
 * 
 * FAL.AI QUEUE API NOTE:
 * Uses generateWithFalQueue with async queue submission + polling.
 * Images are uploaded to fal CDN before submission to avoid payload size issues.
 */
import { NextRequest, NextResponse } from "next/server";
import { GenerateRequest, GenerateResponse, ModelType, SelectedModel, ProviderType } from "@/types";
import { GenerationInput, ModelCapability } from "@/lib/providers/types";
import { resolveAssetRefsInPayload } from "./assetResolver";
import { isS3Configured } from "@/lib/storage/s3";
import {
  resolveInferenceKey,
  resolveInferenceKeyOptional,
  isInferenceKeyError,
  type InferenceKeyError,
} from "@/lib/byok/resolveInferenceKey";
import { generateWithGemini, generateWithGeminiVideo } from "./providers/gemini";
import { generateWithReplicate } from "./providers/replicate";
import { generateWithFalQueue } from "./providers/fal";
import { generateWithKie } from "./providers/kie";
import { generateWithWaveSpeed } from "./providers/wavespeed";
import { safeGenerationLog } from "./providers/safe-generation-log";
import { admitProductionGovernanceRegionRoute } from "@/lib/governance/production";

export const maxDuration = 300; // 5 minute timeout (Vercel hobby plan limit)
export const dynamic = 'force-dynamic'; // Ensure this route is always dynamic


/**
 * Extended request format that supports both legacy and multi-provider requests
 */
interface MultiProviderGenerateRequest extends GenerateRequest {
  selectedModel?: SelectedModel;
  parameters?: Record<string, unknown>;
  /** Dynamic inputs from schema-based connections (e.g., image_url, tail_image_url, prompt) */
  dynamicInputs?: Record<string, string | string[]>;
}


function buildMediaResponse(output: { type: string; data: string; url?: string }): NextResponse {
  if (output.type === "3d") {
    return NextResponse.json<GenerateResponse>({
      success: true,
      model3dUrl: output.url,
      contentType: "3d",
    });
  }

  if (output.type === "video") {
    const isLarge = !output.data && output.url;
    return NextResponse.json<GenerateResponse>({
      success: true,
      video: isLarge ? undefined : output.data,
      videoUrl: isLarge ? output.url : undefined,
      contentType: "video",
    });
  }

  if (output.type === "audio") {
    const isLarge = !output.data && output.url;
    return NextResponse.json<GenerateResponse>({
      success: true,
      audio: isLarge ? undefined : output.data,
      audioUrl: isLarge ? output.url : undefined,
      contentType: "audio",
    });
  }

  return NextResponse.json<GenerateResponse>({
    success: true,
    image: output.data,
    contentType: "image",
  });
}

/**
 * Translate a typed BYOK key-missing error into a 4xx JSON body. Names the
 * provider and points to Settings → Provider Keys; never a 500, never a leaked
 * env var name. `error` mirrors `message` so the existing client error-display
 * path (which reads the `error` field) surfaces it on the node.
 */
function byokErrorResponse(err: InferenceKeyError): NextResponse {
  return NextResponse.json(
    { success: false, error: err.message, ...err.toJSON() },
    { status: 401 }
  );
}

function capabilitiesForMediaType(mediaType?: string): ModelCapability[] {
  const map: Record<string, ModelCapability[]> = {
    audio: ["text-to-audio"],
    video: ["text-to-video"],
    "3d": ["text-to-3d"],
  };
  return map[mediaType ?? ""] ?? ["text-to-image"];
}

export async function POST(request: NextRequest) {
  const requestId = Math.random().toString(36).substring(7);
  safeGenerationLog.log(`\n[API:${requestId}] ========== NEW GENERATE REQUEST ==========`);

  try {
    const body: MultiProviderGenerateRequest = await request.json();
    const { prompt } = body;
    let { images, dynamicInputs } = body;
    const {
      model = "nano-banana-pro",
      aspectRatio,
      resolution,
      useGoogleSearch,
      useImageSearch,
      selectedModel,
      parameters,
      mediaType,
    } = body;

    // Resolve asset references (asset_xxx → base64) when S3 is configured
    const workspaceId = request.headers.get("x-workspace-id");
    if (isS3Configured() && workspaceId) {
      const resolved = await resolveAssetRefsInPayload({
        images,
        dynamicInputs,
        workspaceId,
      });
      images = resolved.images;
      dynamicInputs = resolved.dynamicInputs as typeof dynamicInputs;
    }

    // Prompt is required unless:
    // - Provided via dynamicInputs
    // - Images are provided (image-to-video/image-to-image models)
    // - Dynamic inputs contain image frames (first_frame, last_frame, etc.)
    const hasPrompt = prompt || (dynamicInputs && (
      typeof dynamicInputs.prompt === 'string'
        ? dynamicInputs.prompt
        : Array.isArray(dynamicInputs.prompt) && dynamicInputs.prompt.length > 0
    ));
    const hasImages = (images && images.length > 0);
    const hasImageInputs = dynamicInputs && Object.keys(dynamicInputs).some(key =>
      key.includes('frame') || key.includes('image')
    );

    if (!hasPrompt && !hasImages && !hasImageInputs) {
      return NextResponse.json<GenerateResponse>(
        {
          success: false,
          error: "Prompt or image input is required",
        },
        { status: 400 }
      );
    }

    // Determine which provider to use
    const provider: ProviderType = selectedModel?.provider || "gemini";
    if (workspaceId) {
      const routeId = `provider:${provider}`;
      const configuredRegion = process.env[`PROVIDER_REGION_${provider.toUpperCase().replaceAll("-", "_")}`] ?? "unconfigured";
      const admission = await admitProductionGovernanceRegionRoute({ workspaceId, kind: "processing", routeId, configuredRegion });
      if (!admission.allowed) return NextResponse.json({ success: false, error: "The selected provider route is not admitted by the Workspace Data Region Policy.", code: admission.reason }, { status: 409 });
    }
    safeGenerationLog.log(`[API:${requestId}] Provider: ${provider}, Model: ${selectedModel?.modelId || model}`);

    // Route to appropriate provider
    if (provider === "replicate") {
      if (!selectedModel?.modelId || !selectedModel?.displayName) {
        return NextResponse.json<GenerateResponse>(
          { success: false, error: "selectedModel with modelId and displayName is required for Replicate" },
          { status: 400 }
        );
      }

      // BYOK: request header override → workspace vault → typed error. No env.
      let replicateApiKey: string;
      try {
        replicateApiKey = await resolveInferenceKey({
          headerKey: request.headers.get("X-Replicate-API-Key"),
          workspaceId,
          provider: "replicate",
        });
      } catch (err) {
        if (isInferenceKeyError(err)) return byokErrorResponse(err);
        throw err;
      }

      // Keep Data URIs as-is since localhost URLs won't work (provider can't reach them)
      const processedImages: string[] = images ? [...images] : [];

      // Process dynamicInputs: filter empty values, keep Data URIs
      let processedDynamicInputs: Record<string, string | string[]> | undefined = undefined;

      if (dynamicInputs) {
        processedDynamicInputs = {};
        for (const key of Object.keys(dynamicInputs)) {
          const value = dynamicInputs[key];

          // Skip empty/null/undefined values (arrays pass through)
          if (value === null || value === undefined || value === '') {
            continue;
          }

          // Keep the value as-is (Data URIs work with Replicate)
          processedDynamicInputs[key] = value;
        }
      }

      // Build generation input
      const genInput: GenerationInput = {
        model: {
          id: selectedModel.modelId,
          name: selectedModel.displayName,
          provider: "replicate",
          capabilities: capabilitiesForMediaType(mediaType),
          description: null,
        },
        prompt: prompt || "",
        images: processedImages,
        parameters,
        dynamicInputs: processedDynamicInputs,
      };

      const result = await generateWithReplicate(requestId, replicateApiKey, genInput);

      if (!result.success) {
        return NextResponse.json<GenerateResponse>(
          {
            success: false,
            error: result.error || "Generation failed",
          },
          { status: 500 }
        );
      }

      // Return first output
      const output = result.outputs?.[0];
      if (!output?.data && !output?.url) {
        return NextResponse.json<GenerateResponse>(
          { success: false, error: "No output in generation result" },
          { status: 500 }
        );
      }

      return buildMediaResponse(output);
    }

    if (provider === "fal") {
      if (!selectedModel?.modelId || !selectedModel?.displayName) {
        return NextResponse.json<GenerateResponse>(
          { success: false, error: "selectedModel with modelId and displayName is required for fal.ai" },
          { status: 400 }
        );
      }

      // BYOK: request header override → workspace vault → null. fal.ai supports
      // anonymous (rate-limited) use, so a missing key is a valid state, not an
      // error — but the server env is never consulted.
      const falApiKey = await resolveInferenceKeyOptional({
        headerKey: request.headers.get("X-Fal-API-Key"),
        workspaceId,
        provider: "fal",
      });

      if (!falApiKey) {
        safeGenerationLog.warn(`[API:${requestId}] No FAL API key configured. Proceeding without auth (rate-limited).`);
      }

      // Pass images as-is; generateWithFalQueue uploads base64 to CDN internally
      const processedImages: string[] = images ? [...images] : [];

      // Process dynamicInputs: filter empty values
      let processedDynamicInputs: Record<string, string | string[]> | undefined = undefined;

      if (dynamicInputs) {
        processedDynamicInputs = {};
        for (const key of Object.keys(dynamicInputs)) {
          const value = dynamicInputs[key];

          // Skip empty/null/undefined values (arrays pass through)
          if (value === null || value === undefined || value === '') {
            continue;
          }

          // Keep the value as-is; CDN upload happens in generateWithFalQueue
          processedDynamicInputs[key] = value;
        }
      }

      // Build generation input
      const genInput: GenerationInput = {
        model: {
          id: selectedModel.modelId,
          name: selectedModel.displayName,
          provider: "fal",
          capabilities: capabilitiesForMediaType(mediaType),
          description: null,
        },
        prompt: prompt || "",
        images: processedImages,
        parameters,
        dynamicInputs: processedDynamicInputs,
      };

      const result = await generateWithFalQueue(requestId, falApiKey, genInput);

      if (!result.success) {
        return NextResponse.json<GenerateResponse>(
          {
            success: false,
            error: result.error || "Generation failed",
          },
          { status: 500 }
        );
      }

      // Return first output
      const output = result.outputs?.[0];
      if (!output?.data && !output?.url) {
        return NextResponse.json<GenerateResponse>(
          { success: false, error: "No output in generation result" },
          { status: 500 }
        );
      }

      return buildMediaResponse(output);
    }

    if (provider === "kie") {
      if (!selectedModel?.modelId || !selectedModel?.displayName) {
        return NextResponse.json<GenerateResponse>(
          { success: false, error: "selectedModel with modelId and displayName is required for Kie.ai" },
          { status: 400 }
        );
      }

      // BYOK: request header override → workspace vault → typed error. No env.
      let kieApiKey: string;
      try {
        kieApiKey = await resolveInferenceKey({
          headerKey: request.headers.get("X-Kie-Key"),
          workspaceId,
          provider: "kie",
        });
      } catch (err) {
        if (isInferenceKeyError(err)) return byokErrorResponse(err);
        throw err;
      }

      // Process images - Kie requires URLs, we'll upload base64 images in generateWithKie
      const processedImages: string[] = images ? [...images] : [];

      // Process dynamicInputs: filter empty values
      let processedDynamicInputs: Record<string, string | string[]> | undefined = undefined;

      if (dynamicInputs) {
        processedDynamicInputs = {};
        for (const key of Object.keys(dynamicInputs)) {
          const value = dynamicInputs[key];

          // Skip empty/null/undefined values
          if (value === null || value === undefined || value === '') {
            continue;
          }

          processedDynamicInputs[key] = value;
        }
      }

      // Build generation input
      const genInput: GenerationInput = {
        model: {
          id: selectedModel.modelId,
          name: selectedModel.displayName,
          provider: "kie",
          capabilities: capabilitiesForMediaType(mediaType),
          description: null,
        },
        prompt: prompt || "",
        images: processedImages,
        parameters,
        dynamicInputs: processedDynamicInputs,
      };

      const result = await generateWithKie(requestId, kieApiKey, genInput);

      if (!result.success) {
        return NextResponse.json<GenerateResponse>(
          {
            success: false,
            error: result.error || "Generation failed",
          },
          { status: 500 }
        );
      }

      // Return first output
      const output = result.outputs?.[0];
      if (!output?.data && !output?.url) {
        return NextResponse.json<GenerateResponse>(
          { success: false, error: "No output in generation result" },
          { status: 500 }
        );
      }

      return buildMediaResponse(output);
    }

    if (provider === "wavespeed") {
      if (!selectedModel?.modelId || !selectedModel?.displayName) {
        return NextResponse.json<GenerateResponse>(
          { success: false, error: "selectedModel with modelId and displayName is required for WaveSpeed" },
          { status: 400 }
        );
      }

      // BYOK: request header override → workspace vault → typed error. No env.
      let wavespeedApiKey: string;
      try {
        wavespeedApiKey = await resolveInferenceKey({
          headerKey: request.headers.get("X-WaveSpeed-Key"),
          workspaceId,
          provider: "wavespeed",
        });
      } catch (err) {
        if (isInferenceKeyError(err)) return byokErrorResponse(err);
        throw err;
      }

      // Keep Data URIs as-is since localhost URLs won't work
      const processedImages: string[] = images ? [...images] : [];

      // Process dynamicInputs: filter empty values
      let processedDynamicInputs: Record<string, string | string[]> | undefined = undefined;

      if (dynamicInputs) {
        processedDynamicInputs = {};
        for (const key of Object.keys(dynamicInputs)) {
          const value = dynamicInputs[key];

          // Skip empty/null/undefined values
          if (value === null || value === undefined || value === '') {
            continue;
          }

          processedDynamicInputs[key] = value;
        }
      }

      // Build generation input
      const genInput: GenerationInput = {
        model: {
          id: selectedModel.modelId,
          name: selectedModel.displayName,
          provider: "wavespeed",
          capabilities: capabilitiesForMediaType(mediaType),
          description: null,
        },
        prompt: prompt || "",
        images: processedImages,
        parameters,
        dynamicInputs: processedDynamicInputs,
      };

      const result = await generateWithWaveSpeed(requestId, wavespeedApiKey, genInput);

      if (!result.success) {
        return NextResponse.json<GenerateResponse>(
          {
            success: false,
            error: result.error || "Generation failed",
          },
          { status: 500 }
        );
      }

      // Return first output
      const output = result.outputs?.[0];
      if (!output?.data && !output?.url) {
        return NextResponse.json<GenerateResponse>(
          { success: false, error: "No output in generation result" },
          { status: 500 }
        );
      }

      return buildMediaResponse(output);
    }

    // Default: Use Gemini
    // BYOK: request header override → workspace vault → typed error. No env.
    let geminiApiKey: string;
    try {
      geminiApiKey = await resolveInferenceKey({
        headerKey: request.headers.get("X-Gemini-API-Key"),
        workspaceId,
        provider: "gemini",
      });
    } catch (err) {
      if (isInferenceKeyError(err)) return byokErrorResponse(err);
      throw err;
    }

    // Use selectedModel.modelId if available (new format), fallback to legacy model field
    const geminiModel = (selectedModel?.modelId as ModelType) || model;

    // Resolve prompt: use top-level prompt, fall back to dynamicInputs.prompt
    // This handles cases where the prompt arrives via dynamicInputs instead of top-level
    let resolvedPrompt = prompt;
    if (!resolvedPrompt && dynamicInputs?.prompt) {
      resolvedPrompt = Array.isArray(dynamicInputs.prompt)
        ? dynamicInputs.prompt[0]
        : dynamicInputs.prompt;
    }
    // Validate: if a prompt was provided but isn't a string (corrupted data), return clear error
    // If no prompt provided but images exist, that's valid (image-to-image)
    if (resolvedPrompt !== undefined && resolvedPrompt !== null && typeof resolvedPrompt !== 'string') {
      return NextResponse.json<GenerateResponse>(
        { success: false, error: "prompt must be a string" },
        { status: 400 }
      );
    }

    // Check if this is a Veo video model request
    if (selectedModel?.modelId?.startsWith("veo-")) {
      // Merge negative prompt from dynamic inputs (connected handle) into parameters
      const veoParams = { ...(parameters || {}) };
      if (dynamicInputs?.negative_prompt) {
        const neg = Array.isArray(dynamicInputs.negative_prompt)
          ? dynamicInputs.negative_prompt[0]
          : dynamicInputs.negative_prompt;
        if (neg) veoParams.negativePrompt = neg;
      }
      const result = await generateWithGeminiVideo(
        requestId,
        geminiApiKey,
        selectedModel.modelId,
        resolvedPrompt || "",
        images || [],
        veoParams,
      );

      if (!result.success) {
        return NextResponse.json<GenerateResponse>(
          { success: false, error: result.error || "Video generation failed" },
          { status: 500 }
        );
      }

      const output = result.outputs?.[0];
      if (!output?.data && !output?.url) {
        return NextResponse.json<GenerateResponse>(
          { success: false, error: "No output in video generation result" },
          { status: 500 }
        );
      }

      return buildMediaResponse(output);
    }

    return await generateWithGemini(
      requestId,
      geminiApiKey,
      resolvedPrompt,
      images || [],
      geminiModel,
      aspectRatio,
      resolution,
      useGoogleSearch,
      useImageSearch
    );
  } catch (error) {
    // Extract error information
    let errorMessage = "Generation failed";
    let errorDetails = "";

    if (error instanceof Error) {
      errorMessage = error.message;
      if ("cause" in error && error.cause) {
        errorDetails = JSON.stringify(error.cause);
      }
    }

    // Try to extract more details from API errors
    if (error && typeof error === "object") {
      const apiError = error as Record<string, unknown>;
      if (apiError.status) {
        errorDetails += ` Status: ${apiError.status}`;
      }
      if (apiError.statusText) {
        errorDetails += ` ${apiError.statusText}`;
      }
    }

    // Handle rate limiting
    if (errorMessage.includes("429")) {
      return NextResponse.json<GenerateResponse>(
        {
          success: false,
          error: "Rate limit reached. Please wait and try again.",
        },
        { status: 429 }
      );
    }

    safeGenerationLog.error(`[API:${requestId}] Generation error: ${errorMessage}${errorDetails ? ` (${errorDetails.substring(0, 200)})` : ""}`);
    return NextResponse.json<GenerateResponse>(
      {
        success: false,
        error: errorMessage,
      },
      { status: 500 }
    );
  }
}
