#!/usr/bin/env -S npx tsx
import "./_load-env";
import { pathToFileURL } from "node:url";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { listMcpCapabilityTools } from "@/lib/agent-tools";
import { CAPABILITY_DISPATCHER } from "@/lib/agent-runtime/server-dispatcher";
import {
  AGENT_AUTH_SERVICE,
  createAgentAuthenticatedDispatcher,
} from "@/lib/agent-auth";
import { createCapabilityMcpServer } from "@/lib/agent-tools/mcp";
import type { CapabilityDispatcherPort } from "@/types";

export async function runNodeBananaMcp(
  transport: Transport = new StdioServerTransport(),
  dispatcher?: CapabilityDispatcherPort,
): Promise<Server> {
  const authenticatedDispatcher =
    dispatcher ??
    createAgentAuthenticatedDispatcher({
      agentKey: process.env.NODE_BANANA_AGENT_KEY,
      service: AGENT_AUTH_SERVICE,
      dispatcher: CAPABILITY_DISPATCHER,
    });
  const server = createCapabilityMcpServer(authenticatedDispatcher);
  await server.connect(transport);
  const tools = await listMcpCapabilityTools(authenticatedDispatcher);
  console.error(
    `[node-banana-mcp] ready — ${tools.length} exact capabilities`,
  );
  return server;
}

function isDirectExecution(): boolean {
  const entry = process.argv[1];
  return Boolean(entry && import.meta.url === pathToFileURL(entry).href);
}

if (isDirectExecution()) {
  runNodeBananaMcp().catch((error) => {
    console.error("[node-banana-mcp] fatal:", error);
    process.exitCode = 1;
  });
}
