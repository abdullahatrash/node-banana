import { describe, expect, it } from "vitest";
import {
  getPermissionsForRole,
  requireRole,
  type ContentOSSession,
} from "@/lib/studio/authz";

describe("studio authz helpers", () => {
  const baseSession: ContentOSSession = {
    user: {
      id: "user_1",
      name: "Test User",
      email: "test@example.com",
    },
    workspace: {
      id: "ws_1",
      organizationId: "org_ws_1",
    },
    role: "member",
    planTier: "free",
    permissions: getPermissionsForRole("member"),
  };

  it("maps member role to non-delete permissions", () => {
    const permissions = getPermissionsForRole("member");
    expect(permissions).toContain("projects:write");
    expect(permissions).toContain("assets:write");
    expect(permissions).not.toContain("projects:delete");
    expect(permissions).not.toContain("assets:delete");
  });

  it("allows required role checks", () => {
    expect(requireRole(baseSession, ["member", "admin"])).toBeNull();
  });

  it("returns forbidden failure for missing role", () => {
    const result = requireRole(baseSession, ["owner"]);
    expect(result).toEqual({
      authorized: false,
      status: 403,
      error: "You do not have the required role for this action.",
      reason: "forbidden",
    });
  });
});
