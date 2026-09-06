import { describe, expect, it } from "vitest";
import {
  IDENTITY_ERASURE_FRESH_SESSION_MS,
  isFreshIdentityErasureSession,
  projectIdentityErasurePreflight,
} from "../identity-erasure-contract";

describe("identity erasure contract", () => {
  it("blocks active owners but permits membership removal and closed ownership", () => {
    const blocked = projectIdentityErasurePreflight({
      accountProviders: ["credential", "google"],
      membershipCount: 3,
      ownedWorkspaces: [
        { id: "active", name: "Active Brand", lifecycle: "active" },
        { id: "closed", name: "Closed Brand", lifecycle: "closed" },
      ],
    });
    expect(blocked).toMatchObject({
      canErase: false,
      hasCredential: true,
      requiresFreshSession: false,
      membershipCount: 3,
      blockers: [{ code: "ACTIVE_OWNED_WORKSPACE", workspaceId: "active" }],
    });

    expect(
      projectIdentityErasurePreflight({
        accountProviders: ["google"],
        membershipCount: 2,
        ownedWorkspaces: [{ id: "closed", name: "Closed Brand", lifecycle: "closed" }],
      }),
    ).toMatchObject({ canErase: true, hasCredential: false, requiresFreshSession: true });
  });

  it("requires OAuth-only users to have a session no older than fifteen minutes", () => {
    const now = new Date("2026-09-05T12:15:00.000Z");
    expect(isFreshIdentityErasureSession(new Date(now.getTime() - IDENTITY_ERASURE_FRESH_SESSION_MS), now)).toBe(true);
    expect(isFreshIdentityErasureSession(new Date(now.getTime() - IDENTITY_ERASURE_FRESH_SESSION_MS - 1), now)).toBe(false);
    expect(isFreshIdentityErasureSession(new Date(now.getTime() + 1), now)).toBe(false);
  });
});
