import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";

const mockAuthorize = vi.fn();
const { MockCredentialVaultError } = vi.hoisted(() => ({
  MockCredentialVaultError: class extends Error {
    constructor(readonly code: string, message: string) {
      super(message);
    }
  },
}));

vi.mock("@/lib/db", () => ({ isDatabaseConfigured: () => true }));
vi.mock("@/lib/studio/authz", () => ({
  authorizeStudioRequest: (...args: unknown[]) => mockAuthorize(...args),
  authzErrorResponse: (result: { status: number; error: string }) =>
    NextResponse.json(
      { success: false, error: result.error },
      { status: result.status },
    ),
}));
vi.mock("@/lib/credential-vault", () => ({
  CredentialVaultError: MockCredentialVaultError,
}));
vi.mock("@/lib/agent-runtime/server-dispatcher", () => ({
  CREDENTIAL_HUMAN_CAPABILITIES: {
    invoke: () => {
      throw new MockCredentialVaultError(
        "INVALID_INPUT",
        "Idempotency-Key is required for this credential mutation.",
      );
    },
  },
}));

import { POST as rotate } from "../[profileId]/rotate/route";
import { POST as reprovision } from "../[profileId]/reprovision/route";

const context = { params: Promise.resolve({ profileId: "profile-1" }) };

describe("legacy Credential mutation error parity", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuthorize.mockResolvedValue({
      authorized: true,
      userId: "human-1",
      workspaceId: "workspace-1",
      role: "admin",
    });
  });

  it("returns 400 for a missing key on rotate", async () => {
    const response = await rotate(
      new NextRequest(
        "http://localhost/api/studio/credentials/profile-1/rotate",
        {
          method: "POST",
          headers: { "x-workspace-id": "workspace-1" },
          body: JSON.stringify({
            expectedActiveVersion: 1,
            secret: "private-provider-key",
          }),
        },
      ),
      context,
    );

    expect(response.status).toBe(400);
  });

  it("returns 400 for a missing key on legacy reprovision", async () => {
    const response = await reprovision(
      new NextRequest(
        "http://localhost/api/studio/credentials/profile-1/reprovision",
        {
          method: "POST",
          headers: { "x-workspace-id": "workspace-1" },
          body: JSON.stringify({
            provider: "openai",
            slotName: "primary",
            secret: "private-provider-key",
          }),
        },
      ),
      context,
    );

    expect(response.status).toBe(400);
  });
});
