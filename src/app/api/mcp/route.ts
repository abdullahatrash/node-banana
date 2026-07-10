import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { NextResponse } from "next/server";

import { authorizePublicApiRequest } from "@/lib/api-tokens/auth";
import { buildMcpServer } from "@/lib/agent-tools/mcp/server";
import { isDatabaseConfigured } from "@/lib/db";

const ROUTE = "/api/mcp";

// Streamable HTTP MCP requests can take a while (tool handlers hit the DB);
// give them room beyond the platform default.
export const maxDuration = 60;

/**
 * Hosted MCP endpoint over streamable HTTP.
 *
 * Auth is the same Bearer path as the rest of public API v1: an
 * `Authorization: Bearer nb_...` token resolved (and workspace-scoped) by
 * `authorizePublicApiRequest`. Unauthenticated requests get a 401 with a
 * `WWW-Authenticate` challenge before any MCP handling.
 *
 * The server is built fresh per request from the tool registry and connected to
 * a stateless transport, so nothing is shared across callers or tenants.
 */
async function handle(request: Request): Promise<Response> {
  if (!isDatabaseConfigured()) {
    return NextResponse.json(
      {
        jsonrpc: "2.0",
        error: {
          code: -32000,
          message:
            "DATABASE_URL is not configured. Configure Postgres to use the MCP API.",
        },
        id: null,
      },
      { status: 503 },
    );
  }

  const auth = await authorizePublicApiRequest(request, {
    route: ROUTE,
    permission: "workspaces:read",
  });

  if (!auth.authorized) {
    const response = auth.response;
    response.headers.set(
      "WWW-Authenticate",
      'Bearer realm="node-banana", error="invalid_token"',
    );
    return response;
  }

  const server = buildMcpServer(auth.session);
  const transport = new WebStandardStreamableHTTPServerTransport({
    // Stateless: no session id, and return a complete JSON body per request
    // rather than an open SSE stream — the natural fit for a serverless
    // request/response handler.
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });

  await server.connect(transport);
  return transport.handleRequest(request);
}

export async function POST(request: Request): Promise<Response> {
  return handle(request);
}

export async function GET(request: Request): Promise<Response> {
  return handle(request);
}

export async function DELETE(request: Request): Promise<Response> {
  return handle(request);
}
