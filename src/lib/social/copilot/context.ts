/**
 * Execution context injected into every Social Copilot tool.
 *
 * Tools never read the HTTP session directly — the in-app route supplies this
 * from the Better Auth session, and a future MCP server supplies it from an API
 * key. See ADR 0008.
 */
export interface CopilotContext {
  workspaceId: string;
  userId: string;
}
