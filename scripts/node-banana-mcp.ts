#!/usr/bin/env -S npx tsx
/**
 * Thin stdio MCP adapter over the production Capability Registry.
 *
 * MCP-safe tool names project exact identities reversibly:
 * `capabilities.list@1` -> `capabilities.list.v1`.
 */
import "./_load-env";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import {
  CAPABILITY_REGISTRY,
  dispatchMcpCapability,
  listMcpCapabilityTools,
} from "@/lib/agent-tools";

async function main(): Promise<void> {
  const server = new Server(
    { name: "node-banana", version: "1.0.0" },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: listMcpCapabilityTools(),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const response = await dispatchMcpCapability(
      request.params.name,
      request.params.arguments ?? {},
    );
    return {
      isError: response.type === "capability_error",
      content: [{ type: "text", text: JSON.stringify(response) }],
      structuredContent: response,
    };
  });

  await server.connect(new StdioServerTransport());
  // stdout belongs exclusively to MCP framing.
  console.error(
    `[node-banana-mcp] ready — ${CAPABILITY_REGISTRY.listDefinitions().length} exact capabilities, registry ${CAPABILITY_REGISTRY.digest}`,
  );
}

main().catch((error) => {
  console.error("[node-banana-mcp] fatal:", error);
  process.exit(1);
});
