import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ContentOSSession } from "@/lib/studio/authz";
import { getPermissionsForRole } from "@/lib/studio/authz";

const { mockGetWorkspaceById, mockListSocialAccounts } = vi.hoisted(() => ({
  mockGetWorkspaceById: vi.fn(),
  mockListSocialAccounts: vi.fn(),
}));

vi.mock("@/lib/studio/repository", () => ({
  getWorkspaceById: (...args: unknown[]) => mockGetWorkspaceById(...args),
  listWorkspaceAssets: vi.fn(async () => []),
}));

vi.mock("@/lib/social/repository", () => ({
  listSocialAccounts: (...args: unknown[]) => mockListSocialAccounts(...args),
}));

import { buildMcpServer } from "../server";

function session(
  role: "owner" | "member" = "owner",
  workspaceId = "ws_1",
): ContentOSSession {
  return {
    user: { id: `apitoken:${workspaceId}`, name: null, email: null },
    workspace: { id: workspaceId, organizationId: null },
    role,
    planTier: "free",
    permissions: getPermissionsForRole(role),
  };
}

async function connectClient(sess: ContentOSSession): Promise<Client> {
  const server = buildMcpServer(sess);
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test-client", version: "1.0.0" });
  await Promise.all([
    client.connect(clientTransport),
    server.connect(serverTransport),
  ]);
  return client;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("buildMcpServer (registry-derived MCP tools)", () => {
  it("exposes exactly the registry's tools with input and output schemas", async () => {
    const client = await connectClient(session());

    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name).sort();

    expect(names).toEqual([
      "get_asset_download_url",
      "get_run_status",
      "list_assets",
      "list_social_accounts",
      "list_workspaces",
      "run_workflow",
      "upload_asset",
    ]);
    for (const tool of tools) {
      expect(tool.description).toBeTruthy();
      expect(tool.inputSchema).toBeTruthy();
      expect(tool.outputSchema).toBeTruthy();
    }

    await client.close();
  });

  it("calls a tool and returns structured content scoped to the session", async () => {
    mockGetWorkspaceById.mockResolvedValue({
      id: "ws_1",
      name: "Acme Brand",
      slug: "acme-brand",
    });

    const client = await connectClient(session("owner", "ws_1"));

    const result = await client.callTool({
      name: "list_workspaces",
      arguments: {},
    });

    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toEqual({
      workspaces: [{ id: "ws_1", name: "Acme Brand", slug: "acme-brand" }],
    });
    expect(mockGetWorkspaceById).toHaveBeenCalledWith("ws_1");

    await client.close();
  });

  it("surfaces a structured forbidden error when the role lacks permission", async () => {
    const memberSession = session("member");
    memberSession.permissions = memberSession.permissions.filter(
      (p) => p !== "social:view",
    );

    const client = await connectClient(memberSession);

    const result = await client.callTool({
      name: "list_social_accounts",
      arguments: {},
    });

    expect(result.isError).toBe(true);
    const structured = result.structuredContent as {
      code: string;
      fix: string;
    };
    expect(structured.code).toBe("forbidden");
    expect(structured.fix).toBeTruthy();
    expect(mockListSocialAccounts).not.toHaveBeenCalled();

    await client.close();
  });
});
