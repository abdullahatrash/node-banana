import {
  ToolLoopAgent,
  stepCountIs,
  smoothStream,
  createAgentUIStreamResponse,
  type UIMessage,
  type LanguageModel,
} from "ai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";
import type { CopilotProvider } from "./byok";
import type { CopilotContext } from "./context";
import {
  createCopilotTools,
  COMMIT_TOOL_NAMES,
  DRAFT_CONTEXT_TOOL_NAMES,
} from "./tools";
import { SOCIAL_COPILOT_SYSTEM_PROMPT } from "./prompt";

export interface CopilotRunConfig {
  provider: CopilotProvider;
  modelId: string;
  apiKey: string;
  ctx: CopilotContext;
}

function resolveModel(
  provider: CopilotProvider,
  modelId: string,
  apiKey: string,
): LanguageModel {
  switch (provider) {
    case "anthropic":
      return createAnthropic({ apiKey })(modelId);
    case "google":
      return createGoogleGenerativeAI({ apiKey })(modelId);
    case "openai":
      return createOpenAI({ apiKey })(modelId);
  }
}

/**
 * Assemble the Social Copilot agent per request. The model carries the user's
 * BYOK key, so this is built per call rather than as a shared singleton. Tools
 * and instructions are the transport-agnostic core reused by a future MCP
 * server (ADR 0008).
 */
export function buildSocialCopilotAgent({
  provider,
  modelId,
  apiKey,
  ctx,
}: CopilotRunConfig) {
  const tools = createCopilotTools(ctx);
  const stagedTools = Object.keys(tools).filter(
    (name) => !COMMIT_TOOL_NAMES.includes(name),
  );

  return new ToolLoopAgent({
    model: resolveModel(provider, modelId, apiKey),
    instructions: SOCIAL_COPILOT_SYSTEM_PROMPT,
    tools,
    stopWhen: stepCountIs(12),
    // Hide the irreversible commit tools until the agent is working with a
    // concrete draft, so it can't try to schedule/publish nothing.
    prepareStep: ({ steps }) => {
      const hasDraftContext = steps.some((step) =>
        step.toolCalls?.some((call) =>
          DRAFT_CONTEXT_TOOL_NAMES.includes(call.toolName),
        ),
      );
      if (!hasDraftContext) {
        return { activeTools: stagedTools as Array<keyof typeof tools> };
      }
      return {};
    },
  });
}

export function streamCopilotResponse(
  config: CopilotRunConfig & { messages: UIMessage[] },
): Promise<Response> {
  const agent = buildSocialCopilotAgent(config);
  return createAgentUIStreamResponse({
    agent,
    uiMessages: config.messages,
    // Anthropic streams in bursts; pace them word-by-word for smooth rendering.
    experimental_transform: smoothStream({ chunking: "word" }),
  });
}
