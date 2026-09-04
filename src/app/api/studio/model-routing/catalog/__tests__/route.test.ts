import { beforeEach, describe, expect, it, vi } from "vitest";

const captured = vi.hoisted(() => ({ options: [] as Array<Record<string, unknown>> }));
const mockCatalog = vi.hoisted(() => vi.fn());
const mockReadiness = vi.hoisted(() => vi.fn());

vi.mock("@/lib/studio/withStudioAuth", () => ({
  withStudioAuth: (options: Record<string, unknown>, handler: (...args: unknown[]) => unknown) => {
    captured.options.push(options);
    return (request: Request) => handler(request, { workspaceId: "workspace-a", userId: "user-a" });
  },
}));
vi.mock("@/lib/model-routing/catalog", () => ({ configuredCatalog: () => mockCatalog() }));
vi.mock("@/lib/model-routing/production-readiness", () => ({
  readProductionGenerationReadiness: (...args: unknown[]) => mockReadiness(...args),
}));

import { GET } from "../route";

function request(workspaceId: string) {
  return new Request("http://localhost/api/studio/model-routing/catalog", {
    headers: { "x-workspace-id": workspaceId },
  });
}

describe("model-routing catalog route", () => {
  const items = [{ model: "owner/model" }];
  const generationReadiness = {
    schema: "generation-readiness/v1",
    qualifiedModelCount: 0,
    qualifiedCapabilities: [],
    gates: {
      acceptedBrand: true,
      canonicalMediaStorage: true,
      processingRegion: false,
      byokCredential: false,
      managedCredential: false,
      managedCreditRate: false,
    },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockCatalog.mockReturnValue(items);
    mockReadiness.mockResolvedValue(generationReadiness);
  });

  it("requires product read access", () => {
    expect(captured.options).toEqual([
      { route: "/api/studio/model-routing/catalog", action: "read", permission: "product:read" },
    ]);
  });

  it("returns the authorized workspace readiness projection with the catalog", async () => {
    const response = await GET(request("workspace-a") as never, undefined as never);

    await expect(response.json()).resolves.toEqual({
      success: true,
      snapshot: "2026-09",
      items,
      generationReadiness,
    });
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(mockReadiness).toHaveBeenCalledWith("workspace-a", items);
  });

  it("rejects a workspace header outside the authorized session", async () => {
    const response = await GET(request("workspace-b") as never, undefined as never);

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ success: false, code: "WORKSPACE_REQUIRED" });
    expect(mockCatalog).not.toHaveBeenCalled();
    expect(mockReadiness).not.toHaveBeenCalled();
  });
});
