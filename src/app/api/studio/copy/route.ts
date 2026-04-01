import { streamText, UIMessage, convertToModelMessages } from "ai";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";
import { createAnthropic } from "@ai-sdk/anthropic";

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

function createModel(modelKey: string) {
  const entry = MODEL_REGISTRY[modelKey];
  if (!entry) throw new Error(`Unknown model: ${modelKey}`);

  const apiKey = process.env[entry.envKey];
  if (!apiKey) throw new Error(`${entry.envKey} not configured`);

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

export async function POST(request: Request) {
  try {
    const { messages, model: modelKey, system } = (await request.json()) as CopyRequest;

    const resolvedModel = modelKey || "gemini-2.5-flash";
    const aiModel = createModel(resolvedModel);
    const modelMessages = await convertToModelMessages(messages);

    const result = streamText({
      model: aiModel,
      system,
      messages: modelMessages,
      temperature: 0.9,
      maxOutputTokens: 2048,
    });

    return result.toUIMessageStreamResponse();
  } catch (error) {
    console.error("[Copy API Error]", error);
    return new Response(
      error instanceof Error ? error.message : "Copy generation failed",
      { status: 500 },
    );
  }
}
