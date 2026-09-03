import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  resolve: vi.fn(),
  permissions: vi.fn(),
}));

vi.mock("../repository", () => ({ resolveApiTokenAuthorityByRawToken: (...args: unknown[]) => mocks.resolve(...args) }));
vi.mock("@/lib/studio/authz", () => ({
  resolveWorkspaceMemberPermissions: (...args: unknown[]) => mocks.permissions(...args),
  withApiPermission: vi.fn(),
  authzErrorResponse: vi.fn(),
}));

import { authorizePublicApiRequest } from "../auth";

describe("governed API token authorization", () => {
  beforeEach(() => {
    mocks.resolve.mockReset().mockResolvedValue({ workspaceId: "workspace-a", createdByUserId: "viewer-a" });
    mocks.permissions.mockReset().mockResolvedValue(["workspaces:read", "assets:read", "social:view"]);
  });

  it("uses the token creator's exact active role and denies Viewer writes/publishing", async () => {
    const request = new Request("https://app.example/api/v1/assets", { headers: { authorization: "Bearer nb_exact" } });
    const read = await authorizePublicApiRequest(request, { route: "/api/v1/assets", permission: "assets:read" });
    expect(read.authorized).toBe(true);
    expect(mocks.permissions).toHaveBeenCalledWith({ workspaceId: "workspace-a", userId: "viewer-a" });

    const write = await authorizePublicApiRequest(request, { route: "/api/v1/assets", permission: "assets:write" });
    expect(write.authorized).toBe(false);
    if (!write.authorized) expect(write.response.status).toBe(403);
    const publish = await authorizePublicApiRequest(request, { route: "/api/v1/social-posts", permission: "social:publish" });
    expect(publish.authorized).toBe(false);
  });
});
