import { NextRequest, NextResponse } from "next/server";
import { LLMGenerateRequest, LLMGenerateResponse } from "@/types";
import { logger } from "@/utils/logger";
import { resolveAssetRefsInPayload } from "../generate/assetResolver";
import { isS3Configured } from "@/lib/storage/s3";
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
      text = await generateWithGoogle(prompt, model, temperature, maxTokens, images, requestId, geminiApiKey);
    } else if (provider === "openai") {
      text = await generateWithOpenAI(prompt, model, temperature, maxTokens, images, requestId, openaiApiKey);
    } else if (provider === "anthropic") {
      text = await generateWithAnthropic(prompt, model, temperature, maxTokens, images, requestId, anthropicApiKey);
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
