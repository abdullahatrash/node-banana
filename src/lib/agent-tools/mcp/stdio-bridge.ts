import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

const PROXY_INFO = {
  name: "node-banana-stdio",
  version: "1.0.0",
} as const;

/**
 * Build a low-level MCP server that proxies `tools/list` and `tools/call` to an
 * already-connected upstream client.
 *
 * This is the core of the local stdio harness: the bin connects `upstream` to
 * the *hosted* HTTP endpoint (with the Bearer token), so every proxied call
 * exercises the real hosted auth + registry path rather than touching the
 * database directly. Injecting the client keeps the proxy logic testable
 * without a network.
 */
export function createStdioProxyServer(upstream: Client): Server {
  const server = new Server(PROXY_INFO, {
    capabilities: { tools: {} },
  });

  server.setRequestHandler(ListToolsRequestSchema, async (request) => {
    return upstream.listTools(request.params);
  });

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    return upstream.callTool(request.params);
  });

  return server;
}
