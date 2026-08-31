import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";

const mockAuthorizeStudioRequest = vi.fn();
const mockListGrants = vi.fn();
const mockIssueGrantIdempotent = vi.fn();
const mockRevokeGrantIdempotent = vi.fn();

vi.mock("@/lib/db", () => ({
  isDatabaseConfigured: () => true,
  getDb: vi.fn(),
}));

vi.mock("@/lib/studio/authz", () => ({
  authorizeStudioRequest: (...args: unknown[]) =>
    mockAuthorizeStudioRequest(...args),
  authzErrorResponse: (result: { status: number; error: string }) =>
    NextResponse.json(
      { success: false, error: result.error },
      { status: result.status },
    ),
}));

vi.mock("@/lib/agent-runtime/publishing-approvals/production", () => ({
  PRODUCTION_PUBLISHING_APPROVAL_AUTHORITY_ADMIN: {
    listGrants: (...args: unknown[]) => mockListGrants(...args),
    issueGrantIdempotent: (...args: unknown[]) =>
      mockIssueGrantIdempotent(...args),
    revokeGrantIdempotent: (...args: unknown[]) =>
      mockRevokeGrantIdempotent(...args),
  },
}));

import { GET, POST } from "../route";
import { DELETE } from "../[grantId]/route";

const grant = {
  id: "paag_grant_1",
  workspaceId: "workspace_1",
  userId: "human_subject",
  subjectRoleAtIssue: "admin" as const,
  channelId: "channel_linkedin",
  action: "publish" as const,
  issuedByUserId: "human_admin",
  issuedAt: new Date("2026-08-09T00:00:00.000Z"),
  expiresAt: new Date("2026-08-10T00:00:00.000Z"),
  revokedAt: null,
  revokedByUserId: null,
};

function authorize(role: "owner" | "admin" | "member" = "admin") {
  mockAuthorizeStudioRequest.mockResolvedValue({
    authorized: true,
    workspaceId: "workspace_1",
    userId: "human_admin",
    role,
  });
}

function mutationRequest(method: "POST" | "DELETE", body?: unknown) {
  return new NextRequest(
    "http://localhost:3000/api/studio/publishing-approval-authority",
    {
      method,
      headers: {
        "x-workspace-id": "workspace_1",
        origin: "http://localhost:3000",
        "idempotency-key": "authority-retry-key-123",
        ...(body ? { "content-type": "application/json" } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    },
  );
}

describe("Publishing Approval Authority administration routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authorize();
    mockListGrants.mockResolvedValue([grant]);
    mockIssueGrantIdempotent.mockResolvedValue({ kind: "created", grant });
    mockRevokeGrantIdempotent.mockResolvedValue({
      kind: "created",
      grant: {
        ...grant,
        revokedAt: new Date("2026-08-09T00:10:00.000Z"),
        revokedByUserId: "human_admin",
      },
    });
  });

  it("lists only through an explicit owner/admin administration context", async () => {
    const response = await GET(
      new NextRequest(
        "http://localhost:3000/api/studio/publishing-approval-authority",
        { headers: { "x-workspace-id": "workspace_1" } },
      ),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(mockListGrants).toHaveBeenCalledWith({ workspaceId: "workspace_1" });
    expect(JSON.stringify(await response.json())).not.toMatch(
      /accessToken|refreshToken|storageKey|providerUrl/,
    );
  });

  it("does not let an ordinary member administer decision authority", async () => {
    authorize("member");
    const response = await POST(
      mutationRequest("POST", {
        userId: "human_subject",
        channelId: "channel_linkedin",
        expiresAt: null,
      }),
    );

    expect(response.status).toBe(403);
    expect(mockIssueGrantIdempotent).not.toHaveBeenCalled();
  });

  it("issues a retry-safe exact per-Human per-Channel publish grant", async () => {
    const response = await POST(
      mutationRequest("POST", {
        userId: "human_subject",
        channelId: "channel_linkedin",
        expiresAt: null,
      }),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(mockIssueGrantIdempotent).toHaveBeenCalledWith({
      workspaceId: "workspace_1",
      userId: "human_subject",
      channelId: "channel_linkedin",
      action: "publish",
      issuedByUserId: "human_admin",
      expiresAt: null,
      idempotencyKey: "authority-retry-key-123",
      requestFingerprint: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
    });
  });

  it("rejects caller attempts to claim roles, issuer, or broader actions", async () => {
    const response = await POST(
      mutationRequest("POST", {
        userId: "human_subject",
        subjectRole: "owner",
        channelId: "channel_linkedin",
        expiresAt: null,
        issuedByUserId: "attacker",
        action: "all",
      }),
    );

    expect(response.status).toBe(400);
    expect(mockIssueGrantIdempotent).not.toHaveBeenCalled();
  });

  it("surfaces idempotency conflict and atomically rechecked forbidden results", async () => {
    mockIssueGrantIdempotent.mockResolvedValueOnce({ kind: "conflict" });
    const conflict = await POST(
      mutationRequest("POST", {
        userId: "human_subject",
        channelId: "channel_linkedin",
        expiresAt: null,
      }),
    );
    mockIssueGrantIdempotent.mockResolvedValueOnce({ kind: "forbidden" });
    const forbidden = await POST(
      mutationRequest("POST", {
        userId: "human_subject",
        channelId: "channel_linkedin",
        expiresAt: null,
      }),
    );

    expect(conflict.status).toBe(409);
    expect(forbidden.status).toBe(403);
  });

  it("revokes one exact grant idempotently", async () => {
    const response = await DELETE(mutationRequest("DELETE"), {
      params: Promise.resolve({ grantId: "paag_grant_1" }),
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(mockRevokeGrantIdempotent).toHaveBeenCalledWith({
      workspaceId: "workspace_1",
      grantId: "paag_grant_1",
      revokedByUserId: "human_admin",
      idempotencyKey: "authority-retry-key-123",
      requestFingerprint: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
    });
  });
});
