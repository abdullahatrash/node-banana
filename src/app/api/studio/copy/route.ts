import { streamText, UIMessage, convertToModelMessages } from "ai";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { NextRequest } from "next/server";
import { noStoreJson } from "@/lib/agent-auth/http-request";
import { recordSafeOperationalTrace } from "@/lib/agent-runtime/safe-diagnostics";
import { isDatabaseConfigured } from "@/lib/db";
import { authorizeStudioRequest, authzErrorResponse } from "@/lib/studio/authz";

export const maxDuration = 60;

/**
 * LLM model registry for Simple Studio copy mode.
 * Maps our model IDs to AI SDK provider constructors.
 */
const MODEL_REGISTRY: Record<
  string,
  { provider: "google" | "openai" | "anthropic"; modelId: string; envKey: string }
> = {
  // Google
  "gemini-2.5-flash": { provider: "google", modelId: "gemini-2.5-flash", envKey: "GEMINI_API_KEY" },
  "gemini-3-flash-preview": { provider: "google", modelId: "gemini-3-flash-preview", envKey: "GEMINI_API_KEY" },
  "gemini-3-pro-preview": { provider: "google", modelId: "gemini-3-pro-preview", envKey: "GEMINI_API_KEY" },
  // OpenAI
  "gpt-4.1-mini": { provider: "openai", modelId: "gpt-4.1-mini", envKey: "OPENAI_API_KEY" },
  "gpt-4.1-nano": { provider: "openai", modelId: "gpt-4.1-nano", envKey: "OPENAI_API_KEY" },
  // Anthropic
  "claude-sonnet-4.5": { provider: "anthropic", modelId: "claude-sonnet-4-5-20250929", envKey: "ANTHROPIC_API_KEY" },
  "claude-haiku-4.5": { provider: "anthropic", modelId: "claude-haiku-4-5-20251001", envKey: "ANTHROPIC_API_KEY" },
};

class CopyConfigurationError extends Error {
  constructor(readonly reason: "unsupported_model" | "missing_api_key") {
    super("Copy model configuration is unavailable.");
    this.name = "CopyConfigurationError";
  }
}

function createModel(modelKey: string) {
  const entry = MODEL_REGISTRY[modelKey];
  if (!entry) throw new CopyConfigurationError("unsupported_model");

  const apiKey = process.env[entry.envKey];
  if (!apiKey) throw new CopyConfigurationError("missing_api_key");

  switch (entry.provider) {
    case "google": {
      const google = createGoogleGenerativeAI({ apiKey });
      return google(entry.modelId);
    }
    case "openai": {
      const openai = createOpenAI({ apiKey });
      return openai(entry.modelId);
    }
    case "anthropic": {
      const anthropic = createAnthropic({ apiKey });
      return anthropic(entry.modelId);
    }
  }
}

interface CopyRequest {
  messages: UIMessage[];
  model?: string;
  system?: string;
}

export async function POST(request: NextRequest) {
  if (!isDatabaseConfigured()) {
    return noStoreJson(
      { success: false, error: "DATABASE_URL is not configured." },
      { status: 503 },
    );
  }

  let authorizedWorkspaceId: string | null = null;
  let providerFamily: "google" | "openai" | "unknown" = "unknown";
  try {
    const authz = await authorizeStudioRequest(request, {
      route: "/api/studio/copy",
      action: "read",
    });
    if (!authz.authorized) {
      return authzErrorResponse(authz);
    }
    authorizedWorkspaceId = authz.workspaceId;

    const { messages, model: modelKey, system } = (await request.json()) as CopyRequest;

    const resolvedModel = modelKey || "gemini-2.5-flash";
    const registryEntry = MODEL_REGISTRY[resolvedModel];
    providerFamily =
      registryEntry?.provider === "google" || registryEntry?.provider === "openai"
        ? registryEntry.provider
        : "unknown";
    const aiModel = createModel(resolvedModel);
    const modelMessages = await convertToModelMessages(messages);

    const result = streamText({
      model: aiModel,
      system,
      messages: modelMessages,
      temperature: 0.9,
      maxOutputTokens: 2048,
      onError: async () => {
        await recordSafeOperationalTrace({
          workspaceId: authorizedWorkspaceId,
          category: "provider",
          severity: "error",
          code: "COPY_GENERATION_FAILED",
          stage: "execution",
          outcome: "failed",
          providerFamily,
          httpStatus: null,
          retryable: null,
          durationMs: null,
          attempt: null,
          createdAt: new Date(),
        });
      },
    });

    const response = result.toUIMessageStreamResponse({
      onError: () => "Copy generation failed",
    });
    response.headers.set("Cache-Control", "no-store");
    response.headers.set("Pragma", "no-cache");
    return response;
  } catch (error) {
    const operatorTraceRef = await recordSafeOperationalTrace({
      workspaceId: authorizedWorkspaceId,
      category:
        error instanceof CopyConfigurationError ? "runtime" : "provider",
      severity: "error",
      code: "COPY_GENERATION_FAILED",
      stage: "execution",
      outcome: "failed",
      providerFamily,
      httpStatus: null,
      retryable: error instanceof CopyConfigurationError ? false : null,
      durationMs: null,
      attempt: null,
      createdAt: new Date(),
    });
    const safeMessage =
      error instanceof CopyConfigurationError
        ? error.reason === "missing_api_key"
          ? "Model API key not configured"
          : "Unsupported model selected"
        : "Copy generation failed";
    return noStoreJson(
      {
        success: false,
        error: safeMessage,
        code: "COPY_GENERATION_FAILED",
        operatorTraceRef,
      },
      { status: 500 },
    );
  }
}
