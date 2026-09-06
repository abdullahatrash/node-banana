import type { UIMessage } from "ai";
import type { CopilotProvider } from "./byok";
import type { CopilotContext } from "./context";

export interface CopilotRunConfig {
  provider: CopilotProvider;
  modelId: string;
  apiKey: string;
  ctx: CopilotContext;
}

const unavailable = () => new Error("SOCIAL_COPILOT_ADMITTED_GENERATION_UNAVAILABLE");

/** Direct provider construction is forbidden until the admitted text adapter is qualified. */
export function buildSocialCopilotAgent(_config: CopilotRunConfig): never {
  throw unavailable();
}

/** Fail-closed seam retained for callers while the admitted streaming adapter is qualified. */
export function streamCopilotResponse(_config: CopilotRunConfig & { messages: UIMessage[] }): Promise<Response> {
  return Promise.reject(unavailable());
}
