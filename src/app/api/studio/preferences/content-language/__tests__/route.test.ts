import { beforeEach, describe, expect, it, vi } from "vitest";

const captured = vi.hoisted(() => ({ options: [] as Array<Record<string, unknown>> }));
const mockGet = vi.hoisted(() => vi.fn());
const mockUpdate = vi.hoisted(() => vi.fn());

vi.mock("@/lib/studio/withStudioAuth", () => ({
  withStudioAuth: (options: Record<string, unknown>, handler: (...args: unknown[]) => unknown) => {
    captured.options.push(options);
    return (request: Request) => handler(request, { workspaceId: "workspace-a", userId: "user-a" });
  },
}));
vi.mock("@/lib/product-surfaces/workspace-language-preferences", () => ({
  getWorkspaceContentLanguage: (...args: unknown[]) => mockGet(...args),
  updateWorkspaceContentLanguage: (...args: unknown[]) => mockUpdate(...args),
}));

import { GET, PATCH } from "../route";

function patchRequest(body: unknown) {
  return new Request("http://localhost/api/studio/preferences/content-language", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("Workspace content-language preferences route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGet.mockResolvedValue("ar");
    mockUpdate.mockResolvedValue("en");
  });

  it("uses explicit read and content-write capabilities", () => {
    expect(captured.options).toEqual([
      { route: "/api/studio/preferences/content-language", action: "read", permission: "product:read" },
      { route: "/api/studio/preferences/content-language", action: "write", permission: "product:content:write" },
    ]);
  });

  it("reads the authorized Workspace projection", async () => {
    const response = await GET(new Request("http://localhost/api/studio/preferences/content-language") as never, undefined as never);
    await expect(response.json()).resolves.toEqual({ success: true, contentLanguage: "ar" });
    expect(mockGet).toHaveBeenCalledWith("workspace-a");
  });

  it("updates only the authorized Workspace from validated input", async () => {
    const response = await PATCH(patchRequest({ contentLanguage: "en" }) as never, undefined as never);
    await expect(response.json()).resolves.toEqual({ success: true, contentLanguage: "en" });
    expect(mockUpdate).toHaveBeenCalledWith({ workspaceId: "workspace-a", contentLanguage: "en" });
  });

  it("rejects malformed bodies before persistence", async () => {
    const response = await PATCH(patchRequest(null) as never, undefined as never);
    expect(response.status).toBe(400);
    expect(mockUpdate).not.toHaveBeenCalled();
  });
});
