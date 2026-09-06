import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";

const mockAuthorize = vi.fn();
const mockCreate = vi.fn();
const mockList = vi.fn();
const { MockCredentialVaultError } = vi.hoisted(() => ({
  MockCredentialVaultError: class extends Error {
    constructor(readonly code: string, message: string) {
      super(message);
    }
  },
}));

vi.mock("@/lib/db", () => ({
  isDatabaseConfigured: () => true,
}));
vi.mock("@/lib/studio/authz", () => ({
  authorizeStudioRequest: (...args: unknown[]) => mockAuthorize(...args),
  authzErrorResponse: (result: { status: number; error: string }) =>
    NextResponse.json(
      { success: false, error: result.error },
      { status: result.status },
    ),
}));
vi.mock("@/lib/credential-vault", () => {
  return {
    CredentialVaultError: MockCredentialVaultError,
  };
});
vi.mock("@/lib/agent-runtime/server-dispatcher", () => ({
  CREDENTIAL_HUMAN_CAPABILITIES: {
      invoke: (
        identity: string,
        input: unknown,
        context: { role?: string; idempotencyKey?: string },
      ) => {
        if (context.role === "member") {
          throw new MockCredentialVaultError(
            "FORBIDDEN",
            "Only Workspace owners and admins can manage credentials.",
          );
        }
        if (
          identity === "credentials.profiles.create@1" &&
          !context.idempotencyKey
        ) {
          throw new MockCredentialVaultError(
            "INVALID_INPUT",
            "Idempotency-Key is required for this credential mutation.",
          );
        }
        return identity === "credentials.profiles.create@1"
          ? mockCreate(input, context)
          : mockList(input, context);
      },
  },
}));
vi.mock("@/lib/governance/step-up-http", () => ({ requireGovernanceStepUp: vi.fn(async () => null) }));

import { GET, POST } from "../route";

function authorize(role: "owner" | "admin" | "member") {
  mockAuthorize.mockResolvedValue({
    authorized: true,
    userId: "human-1",
    workspaceId: "workspace-1",
    role,
  });
}

describe("Credential Cockpit route", () => {
  beforeEach(() => vi.clearAllMocks());

  it("accepts secret handoff only from owner/admin and never returns it", async () => {
    authorize("admin");
    mockCreate.mockResolvedValue({
      id: "profile-1",
      workspaceId: "workspace-1",
      name: "Production",
      provider: "openai",
      slotId: "slot-1",
      slotName: "writer",
      status: "active",
      activeVersion: 1,
      secretHint: "••••1234",
      rotatedAt: new Date("2026-07-25T00:00:00.000Z"),
    });
    const secret = "sk-route-secret-1234";
    const response = await POST(
      new NextRequest("http://localhost/api/studio/credentials", {
        method: "POST",
        headers: {
          "x-workspace-id": "workspace-1",
          "idempotency-key": "route-profile-create",
        },
        body: JSON.stringify({
          name: "Production",
          provider: "openai",
          slotName: "writer",
          secret,
        }),
      }),
      undefined,
    );
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(JSON.stringify(body)).not.toContain(secret);
    expect(JSON.stringify(body)).not.toContain("secretCiphertext");
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "Production",
        secret,
      }),
      expect.objectContaining({
        workspaceId: "workspace-1",
        userId: "human-1",
      }),
    );
  });

  it("returns 400 when a key-required legacy mutation omits Idempotency-Key", async () => {
    authorize("admin");
    const response = await POST(
      new NextRequest("http://localhost/api/studio/credentials", {
        method: "POST",
        headers: { "x-workspace-id": "workspace-1" },
        body: JSON.stringify({
          name: "Production",
          provider: "openai",
          slotName: "writer",
          secret: "sk-route-secret-1234",
        }),
      }),
      undefined,
    );

    expect(response.status).toBe(400);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("denies member secret handoff before the vault", async () => {
    authorize("member");
    const response = await POST(
      new NextRequest("http://localhost/api/studio/credentials", {
        method: "POST",
        headers: { "x-workspace-id": "workspace-1" },
        body: JSON.stringify({
          name: "Denied",
          provider: "openai",
          slotName: "writer",
          secret: "never-stored",
        }),
      }),
      undefined,
    );

    expect(response.status).toBe(403);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("lists safe metadata with no-store", async () => {
    authorize("owner");
    mockList.mockResolvedValue([]);
    const response = await GET(
      new NextRequest("http://localhost/api/studio/credentials", {
        headers: { "x-workspace-id": "workspace-1" },
      }),
      undefined,
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(mockList).toHaveBeenCalledWith(
      {},
      expect.objectContaining({ workspaceId: "workspace-1" }),
    );
  });

  it("does not expose Credential Profile metadata to members", async () => {
    authorize("member");
    const response = await GET(
      new NextRequest("http://localhost/api/studio/credentials", {
        headers: { "x-workspace-id": "workspace-1" },
      }),
      undefined,
    );

    expect(response.status).toBe(403);
    expect(mockList).not.toHaveBeenCalled();
  });

  it("requires the explicitly selected Workspace and never falls back to membership", async () => {
    authorize("owner");
    const missing = await GET(
      new NextRequest("http://localhost/api/studio/credentials"),
      undefined,
    );
    const mismatched = await GET(
      new NextRequest("http://localhost/api/studio/credentials", {
        headers: { "x-workspace-id": "workspace-2" },
      }),
      undefined,
    );

    expect(missing.status).toBe(403);
    expect(mismatched.status).toBe(403);
    expect(await missing.json()).toEqual(await mismatched.json());
    expect(mockList).not.toHaveBeenCalled();
  });
});
