#!/usr/bin/env -S npx tsx
/**
 * Local stdio MCP entry point for agent harnesses (Claude Code, etc.).
 *
 * It does NOT touch the database or the tool registry directly — it bridges a
 * local stdio MCP channel to the *hosted* streamable-HTTP endpoint, forwarding
 * every request with the configured Bearer token. That way local harnesses
 * exercise the exact same hosted auth + workspace-scoping path as remote ones.
 *
 * Usage:
 *   NB_API_URL=https://your-app.example NB_API_TOKEN=nb_xxx pnpm mcp:stdio
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { createStdioProxyServer } from "../src/lib/agent-tools/mcp/stdio-bridge";

async function main(): Promise<void> {
  const token = process.env.NB_API_TOKEN;
  const baseUrl = process.env.NB_API_URL;

  if (!token) {
    console.error("NB_API_TOKEN is required (a workspace API token, nb_...).");
    process.exit(1);
  }
  if (!baseUrl) {
    console.error(
      "NB_API_URL is required (e.g. https://your-node-banana.example).",
    );
    process.exit(1);
  }

  const endpoint = new URL("/api/mcp", baseUrl);

  const upstream = new Client({
    name: "node-banana-stdio-proxy",
    version: "1.0.0",
  });
  const httpTransport = new StreamableHTTPClientTransport(endpoint, {
    requestInit: {
      headers: { Authorization: `Bearer ${token}` },
    },
  });
  await upstream.connect(httpTransport);

  const proxy = createStdioProxyServer(upstream);
  await proxy.connect(new StdioServerTransport());

  // stdout is the MCP channel; all diagnostics must go to stderr.
  console.error(`node-banana MCP stdio bridge connected -> ${endpoint.href}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
