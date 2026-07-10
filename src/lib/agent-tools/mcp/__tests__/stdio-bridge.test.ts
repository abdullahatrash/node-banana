import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ContentOSSession } from "@/lib/studio/authz";
import { getPermissionsForRole } from "@/lib/studio/authz";

const { mockGetWorkspaceById } = vi.hoisted(() => ({
  mockGetWorkspaceById: vi.fn(),
}));

vi.mock("@/lib/studio/repository", () => ({
  getWorkspaceById: (...args: unknown[]) => mockGetWorkspaceById(...args),
  listWorkspaceAssets: vi.fn(async () => []),
}));

vi.mock("@/lib/social/repository", () => ({
  listSocialAccounts: vi.fn(async () => []),
}));

import { buildMcpServer } from "../server";
import { createStdioProxyServer } from "../stdio-bridge";

function ownerSession(workspaceId = "ws_1"): ContentOSSession {
  return {
    user: { id: `apitoken:${workspaceId}`, name: null, email: null },
    workspace: { id: workspaceId, organizationId: null },
    role: "owner",
    planTier: "free",
    permissions: getPermissionsForRole("owner"),
  };
}

/**
 * Stand up the full local-harness path in memory:
 *   downstream client (stdin/stdout stand-in)
 *     -> proxy server (what the bin runs)
 *       -> upstream client
 *         -> hosted MCP server (built from the registry)
 * The proxy must forward tools/list and tools/call across that chain, exactly
 * as the shipped bin does over real stdio + HTTP.
 */
async function connectDownstream(): Promise<Client> {
  const hostedServer = buildMcpServer(ownerSession("ws_1"));
  const [upstreamClientT, hostedServerT] = InMemoryTransport.createLinkedPair();
  const upstream = new Client({ name: "upstream", version: "1.0.0" });
  await Promise.all([
    upstream.connect(upstreamClientT),
    hostedServer.connect(hostedServerT),
  ]);

  const proxy = createStdioProxyServer(upstream);
  const [downstreamClientT, proxyServerT] = InMemoryTransport.createLinkedPair();
  const downstream = new Client({ name: "downstream", version: "1.0.0" });
  await Promise.all([
    downstream.connect(downstreamClientT),
    proxy.connect(proxyServerT),
  ]);

  return downstream;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("createStdioProxyServer", () => {
  it("forwards tools/list from the upstream MCP server", async () => {
    const downstream = await connectDownstream();

    const { tools } = await downstream.listTools();

    expect(tools.map((t) => t.name).sort()).toEqual([
      "list_assets",
      "list_social_accounts",
      "list_workspaces",
    ]);

    await downstream.close();
  });

  it("forwards tools/call and returns the upstream result", async () => {
    mockGetWorkspaceById.mockResolvedValue({
      id: "ws_1",
      name: "Acme Brand",
      slug: "acme-brand",
    });

    const downstream = await connectDownstream();

    const result = await downstream.callTool({
      name: "list_workspaces",
      arguments: {},
    });

    expect(result.structuredContent).toEqual({
      workspaces: [{ id: "ws_1", name: "Acme Brand", slug: "acme-brand" }],
    });

    await downstream.close();
  });
});
