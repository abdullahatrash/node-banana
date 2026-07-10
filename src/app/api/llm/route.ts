import { NextRequest, NextResponse } from "next/server";
import { LLMGenerateRequest, LLMGenerateResponse } from "@/types";
import { logger } from "@/utils/logger";
import { resolveAssetRefsInPayload } from "../generate/assetResolver";
import { isS3Configured } from "@/lib/storage/s3";
import {
  resolveInferenceKey,
  isInferenceKeyError,
} from "@/lib/byok/resolveInferenceKey";
import { generateWithGoogle, generateWithOpenAI, generateWithAnthropic } from "./core";

export const maxDuration = 60; // 1 minute timeout

// Generate a unique request ID for tracking
function generateRequestId(): string {
  return `llm-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}

export async function POST(request: NextRequest) {
  const requestId = generateRequestId();

  try {
    // Get user-provided API keys from headers (override env variables)
    const geminiApiKey = request.headers.get("X-Gemini-API-Key");
    const openaiApiKey = request.headers.get("X-OpenAI-API-Key");
    const anthropicApiKey = request.headers.get("X-Anthropic-API-Key");

    const body: LLMGenerateRequest = await request.json();
    let { images } = body;
    const {
      prompt,
      provider,
      model,
      temperature = 0.7,
      maxTokens = 1024
    } = body;

    // Resolve asset references (asset_xxx → base64) when S3 is configured
    const workspaceId = request.headers.get("x-workspace-id");
    if (isS3Configured() && workspaceId && images && images.length > 0) {
      const resolved = await resolveAssetRefsInPayload({ images, workspaceId });
      images = resolved.images;
    }

    logger.info('api.llm', 'LLM generation request received', {
      requestId,
      provider,
      model,
      temperature,
      maxTokens,
      hasImages: !!(images && images.length > 0),
      imageCount: images?.length || 0,
      prompt,
    });

    if (!prompt) {
      logger.warn('api.llm', 'LLM request validation failed: missing prompt', { requestId });
      return NextResponse.json<LLMGenerateResponse>(
        { success: false, error: "Prompt is required" },
        { status: 400 }
      );
    }

    let text: string;

    if (provider === "google") {
      // BYOK: request header override → workspace vault → typed error. No env.
      const apiKey = await resolveInferenceKey({
        headerKey: geminiApiKey,
        workspaceId,
        provider: "gemini",
      });
      text = await generateWithGoogle(prompt, model, temperature, maxTokens, images, requestId, apiKey);
    } else if (provider === "openai") {
      const apiKey = await resolveInferenceKey({
        headerKey: openaiApiKey,
        workspaceId,
        provider: "openai",
      });
      text = await generateWithOpenAI(prompt, model, temperature, maxTokens, images, requestId, apiKey);
    } else if (provider === "anthropic") {
      const apiKey = await resolveInferenceKey({
        headerKey: anthropicApiKey,
        workspaceId,
        provider: "anthropic",
      });
      text = await generateWithAnthropic(prompt, model, temperature, maxTokens, images, requestId, apiKey);
    } else {
      logger.warn('api.llm', 'Unknown provider requested', { requestId, provider });
      return NextResponse.json<LLMGenerateResponse>(
        { success: false, error: `Unknown provider: ${provider}` },
        { status: 400 }
      );
    }

    logger.info('api.llm', 'LLM generation successful', {
      requestId,
      responseLength: text.length,
    });

    return NextResponse.json<LLMGenerateResponse>({
      success: true,
      text,
    });
  } catch (error) {
    // No resolvable BYOK key: return a typed 4xx naming the provider and
    // pointing to Settings → Provider Keys — never a 500, never a leaked env
    // name. `error` mirrors `message` so the node error-display path shows it.
    if (isInferenceKeyError(error)) {
      logger.warn('api.llm', 'BYOK key missing', { requestId, provider: error.provider });
      return NextResponse.json(
        { success: false, error: error.message, ...error.toJSON() },
        { status: 401 }
      );
    }

    logger.error('api.error', 'LLM generation error', { requestId }, error instanceof Error ? error : undefined);

    // Handle rate limiting
    if (error instanceof Error && error.message.includes("429")) {
      return NextResponse.json<LLMGenerateResponse>(
        { success: false, error: "Rate limit reached. Please wait and try again." },
        { status: 429 }
      );
    }

    return NextResponse.json<LLMGenerateResponse>(
      {
        success: false,
        error: error instanceof Error ? error.message : "LLM generation failed",
      },
      { status: 500 }
    );
  }
}
