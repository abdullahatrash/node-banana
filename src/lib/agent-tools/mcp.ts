import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import {
  dispatchMcpCapability,
  listMcpCapabilityTools,
} from "./adapters";
import { CAPABILITY_DISPATCHER } from "@/lib/agent-runtime/server-dispatcher";
import type { CapabilityDispatcherPort } from "@/types/capabilities";

export function createCapabilityMcpServer(
  dispatcher: CapabilityDispatcherPort = CAPABILITY_DISPATCHER,
): Server {
  const server = new Server(
    { name: "node-banana", version: "1.0.0" },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: await listMcpCapabilityTools(dispatcher),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const response = await dispatchMcpCapability(
      request.params.name,
      request.params.arguments ?? {},
      dispatcher,
    );
    return {
      isError: response.type === "capability_error",
      content: [{ type: "text" as const, text: JSON.stringify(response) }],
      structuredContent: response,
    };
  });

  return server;
}
