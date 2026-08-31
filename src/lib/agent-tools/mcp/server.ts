import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import type { ContentOSSession } from "@/lib/studio/authz";

import { toStructuredError } from "../errors";
import { toolRegistry } from "../registry";
import { runTool } from "../runtime";

const SERVER_INFO = {
  name: "node-banana",
  version: "1.0.0",
} as const;

/**
 * Build an MCP server whose tools are derived mechanically from the tool
 * registry — the server never hand-declares a tool. For each registry entry we
 * register the same Zod input/output schemas the registry owns and delegate
 * execution to `runTool`, so MCP behaviour (validation, authz, structured
 * errors) is identical to every other surface.
 *
 * The server is bound to one already-resolved, workspace-scoped session; build
 * a fresh server per authenticated request (stateless transport) so no state or
 * credentials leak across callers.
 */
export function buildMcpServer(session: ContentOSSession): McpServer {
  const server = new McpServer(SERVER_INFO);

  for (const tool of toolRegistry) {
    server.registerTool(
      tool.name,
      {
        description: tool.description,
        inputSchema: tool.inputSchema,
        outputSchema: tool.outputSchema,
      },
      async (input: unknown) => {
        try {
          const output = await runTool(tool, input, { session });
          return {
            content: [{ type: "text" as const, text: JSON.stringify(output) }],
            structuredContent: output as Record<string, unknown>,
          };
        } catch (error) {
          const structured = toStructuredError(error);
          return {
            isError: true,
            content: [
              { type: "text" as const, text: JSON.stringify(structured) },
            ],
            structuredContent: structured as unknown as Record<string, unknown>,
          };
        }
      },
    );
  }

  return server;
}
