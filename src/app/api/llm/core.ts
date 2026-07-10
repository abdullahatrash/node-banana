import { GoogleGenAI } from "@google/genai";
import { LLMModelType } from "@/types";
import { logger } from "@/utils/logger";

/**
 * Callable core of the LLM text-generation route.
 *
 * The HTTP `POST` handler is a thin wrapper over {@link generateLlmText}; the
 * server-side workflow runner calls the same function directly (no self-HTTP),
 * so text generation behaves identically whether driven by the browser or an
 * API/MCP/CLI workflow run.
 */

// Map model types to actual API model IDs
const GOOGLE_MODEL_MAP: Record<string, string> = {
  "gemini-2.5-flash": "gemini-2.5-flash",
  "gemini-3-flash-preview": "gemini-3-flash-preview",
  "gemini-3-pro-preview": "gemini-3-pro-preview",
  "gemini-3.1-pro-preview": "gemini-3.1-pro-preview",
};

const OPENAI_MODEL_MAP: Record<string, string> = {
  "gpt-4.1-mini": "gpt-4.1-mini",
  "gpt-4.1-nano": "gpt-4.1-nano",
};

const ANTHROPIC_MODEL_MAP: Record<string, string> = {
  "claude-sonnet-4.5": "claude-sonnet-4-5-20250929",
  "claude-haiku-4.5": "claude-haiku-4-5-20251001",
  "claude-opus-4.6": "claude-opus-4-6",
};

export async function generateWithGoogle(
  prompt: string,
  model: LLMModelType,
  temperature: number,
  maxTokens: number,
  images?: string[],
  requestId?: string,
  userApiKey?: string | null
): Promise<string> {
  // User-provided key takes precedence over env variable
  const apiKey = userApiKey || process.env.GEMINI_API_KEY;
  if (!apiKey) {
    logger.error('api.error', 'GEMINI_API_KEY not configured', { requestId });
    throw new Error("GEMINI_API_KEY not configured. Add it to .env.local or configure in Settings.");
  }

  const ai = new GoogleGenAI({ apiKey });
  const modelId = GOOGLE_MODEL_MAP[model];

  logger.info('api.llm', 'Calling Google AI API', {
    requestId,
    model: modelId,
    temperature,
    maxTokens,
    imageCount: images?.length || 0,
    promptLength: prompt.length,
  });

  // Build multimodal content if images are provided
  let contents: string | Array<{ inlineData: { mimeType: string; data: string } } | { text: string }>;
  if (images && images.length > 0) {
    contents = [
      ...images.map((img) => {
        // Extract base64 data and mime type from data URL
        const matches = img.match(/^data:(.+?);base64,(.+)$/);
        if (matches) {
          return {
            inlineData: {
              mimeType: matches[1],
              data: matches[2],
            },
          };
        }
        // Fallback: assume PNG if no data URL prefix
        return {
          inlineData: {
            mimeType: "image/png",
            data: img,
          },
        };
      }),
      { text: prompt },
    ];
  } else {
    contents = prompt;
  }

  const startTime = Date.now();
  const response = await ai.models.generateContent({
    model: modelId,
    contents,
    config: {
      temperature,
      maxOutputTokens: maxTokens,
    },
  });
  const duration = Date.now() - startTime;

  // Use the convenient .text property that concatenates all text parts
  const text = response.text;
  if (!text) {
    logger.error('api.error', 'No text in Google AI response', { requestId });
    throw new Error("No text in Google AI response");
  }

  logger.info('api.llm', 'Google AI API response received', {
    requestId,
    duration,
    responseLength: text.length,
  });

  return text;
}

export async function generateWithOpenAI(
  prompt: string,
  model: LLMModelType,
  temperature: number,
  maxTokens: number,
  images?: string[],
  requestId?: string,
  userApiKey?: string | null
): Promise<string> {
  // User-provided key takes precedence over env variable
  const apiKey = userApiKey || process.env.OPENAI_API_KEY;
  if (!apiKey) {
    logger.error('api.error', 'OPENAI_API_KEY not configured', { requestId });
    throw new Error("OPENAI_API_KEY not configured. Add it to .env.local or configure in Settings.");
  }

  const modelId = OPENAI_MODEL_MAP[model];

  logger.info('api.llm', 'Calling OpenAI API', {
    requestId,
    model: modelId,
    temperature,
    maxTokens,
    imageCount: images?.length || 0,
    promptLength: prompt.length,
  });

  // Build content array for vision if images are provided
  let content: string | Array<{ type: string; text?: string; image_url?: { url: string } }>;
  if (images && images.length > 0) {
    content = [
      { type: "text", text: prompt },
      ...images.map((img) => ({
        type: "image_url" as const,
        image_url: { url: img },
      })),
    ];
  } else {
    content = prompt;
  }

  const startTime = Date.now();
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: modelId,
      messages: [{ role: "user", content }],
      temperature,
      max_tokens: maxTokens,
    }),
  });
  const duration = Date.now() - startTime;

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    logger.error('api.error', 'OpenAI API request failed', {
      requestId,
      status: response.status,
      error: error.error?.message,
    });
    throw new Error(error.error?.message || `OpenAI API error: ${response.status}`);
  }

  const data = await response.json();
  const text = data.choices?.[0]?.message?.content;

  if (!text) {
    logger.error('api.error', 'No text in OpenAI response', { requestId });
    throw new Error("No text in OpenAI response");
  }

  logger.info('api.llm', 'OpenAI API response received', {
    requestId,
    duration,
    responseLength: text.length,
  });

  return text;
}

export async function generateWithAnthropic(
  prompt: string,
  model: LLMModelType,
  temperature: number,
  maxTokens: number,
  images?: string[],
  requestId?: string,
  userApiKey?: string | null
): Promise<string> {
  const apiKey = userApiKey || process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    logger.error('api.error', 'ANTHROPIC_API_KEY not configured', { requestId });
    throw new Error("ANTHROPIC_API_KEY not configured. Add it to .env.local or configure in Settings.");
  }

  const modelId = ANTHROPIC_MODEL_MAP[model];

  logger.info('api.llm', 'Calling Anthropic API', {
    requestId,
    model: modelId,
    temperature,
    maxTokens,
    imageCount: images?.length || 0,
    promptLength: prompt.length,
  });

  // Build content blocks
  const content: Array<{ type: string; text?: string; source?: { type: string; media_type: string; data: string } }> = [];

  if (images && images.length > 0) {
    for (const img of images) {
      const matches = img.match(/^data:(.+?);base64,(.+)$/);
      if (matches) {
        content.push({
          type: "image",
          source: { type: "base64", media_type: matches[1], data: matches[2] },
        });
      } else {
        content.push({
          type: "image",
          source: { type: "base64", media_type: "image/png", data: img },
        });
      }
    }
  }

  content.push({ type: "text", text: prompt });

  const startTime = Date.now();
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: modelId,
      messages: [{ role: "user", content }],
      temperature,
      max_tokens: maxTokens,
    }),
  });
  const duration = Date.now() - startTime;

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    logger.error('api.error', 'Anthropic API request failed', {
      requestId,
      status: response.status,
      error: error.error?.message,
    });
    throw new Error(error.error?.message || `Anthropic API error: ${response.status}`);
  }

  const data = await response.json();
  const text = data.content?.[0]?.text;

  if (!text) {
    logger.error('api.error', 'No text in Anthropic response', { requestId });
    throw new Error("No text in Anthropic response");
  }

  logger.info('api.llm', 'Anthropic API response received', {
    requestId,
    duration,
    responseLength: text.length,
  });

  return text;
}

export interface LlmCoreParams {
  provider: string;
  model: LLMModelType;
  prompt: string;
  images?: string[];
  temperature?: number;
  maxTokens?: number;
  requestId?: string;
  /** Per-request provider keys; each falls back to its env variable inside. */
  keys?: {
    google?: string | null;
    openai?: string | null;
    anthropic?: string | null;
  };
}

/**
 * Dispatch a text-generation request to the right provider. Throws on an
 * unknown provider or a provider-side failure; the caller decides how to
 * surface it (HTTP status, run-node error, etc.).
 */
export async function generateLlmText(params: LlmCoreParams): Promise<string> {
  const {
    provider,
    model,
    prompt,
    images,
    temperature = 0.7,
    maxTokens = 1024,
    requestId,
    keys,
  } = params;

  if (provider === "google") {
    return generateWithGoogle(prompt, model, temperature, maxTokens, images, requestId, keys?.google);
  }
  if (provider === "openai") {
    return generateWithOpenAI(prompt, model, temperature, maxTokens, images, requestId, keys?.openai);
  }
  if (provider === "anthropic") {
    return generateWithAnthropic(prompt, model, temperature, maxTokens, images, requestId, keys?.anthropic);
  }
  throw new Error(`Unknown provider: ${provider}`);
}
