import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";

const {
  mockIsDatabaseConfigured,
  mockAuthorizeStudioRequest,
  mockListProviderKeys,
  mockUpsertProviderKey,
  mockValidateProviderKey,
  mockRequireGovernanceStepUp,
} = vi.hoisted(() => ({
  mockIsDatabaseConfigured: vi.fn(() => true),
  mockAuthorizeStudioRequest: vi.fn(),
  mockListProviderKeys: vi.fn(),
  mockUpsertProviderKey: vi.fn(),
  mockValidateProviderKey: vi.fn(),
  mockRequireGovernanceStepUp: vi.fn(async (_input: unknown): Promise<unknown> => null),
}));

vi.mock("@/lib/db", () => ({
  isDatabaseConfigured: () => mockIsDatabaseConfigured(),
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

vi.mock("@/lib/byok/repository", () => ({
  listProviderKeys: (...args: unknown[]) => mockListProviderKeys(...args),
  upsertProviderKey: (...args: unknown[]) => mockUpsertProviderKey(...args),
}));

vi.mock("@/lib/byok/validation", () => ({
  validateProviderKey: (...args: unknown[]) => mockValidateProviderKey(...args),
}));
vi.mock("@/lib/governance/step-up-http", () => ({ requireGovernanceStepUp: (input: unknown) => mockRequireGovernanceStepUp(input) }));

import { GET, POST } from "../route";

function createRequest(body?: unknown): NextRequest {
  return {
    headers: new Headers(),
    nextUrl: new URL("http://localhost:3000/api/keys"),
    json: async () => body,
  } as unknown as NextRequest;
}

function authorizedAs(workspaceId: string, userId = "user_1") {
  mockAuthorizeStudioRequest.mockResolvedValue({
    authorized: true,
    userId,
    workspaceId,
    role: "owner",
    permissions: ["workspaces:read", "workspaces:write"],
    contentSession: {},
  });
}

function unauthorized(status: 401 | 403, error: string) {
  mockAuthorizeStudioRequest.mockResolvedValue({
    authorized: false,
    status,
    error,
    reason: status === 401 ? "unauthenticated" : "forbidden",
  });
}

describe("/api/keys", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIsDatabaseConfigured.mockReturnValue(true);
  });

  describe("GET (list)", () => {
    it("lists the workspace's provider keys as masked summaries only", async () => {
      authorizedAs("ws_1");
      const now = new Date("2026-07-10T00:00:00.000Z");
      mockListProviderKeys.mockResolvedValue([
        { provider: "openai", hint: "sk-…test", lastValidatedAt: now, updatedAt: now },
      ]);

      const response = await GET(createRequest());
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.keys).toHaveLength(1);
      expect(data.keys[0]).toEqual(
        expect.objectContaining({ provider: "openai", hint: "sk-…test" }),
      );
      expect(JSON.stringify(data)).not.toContain("keyEncrypted");
      expect(mockListProviderKeys).toHaveBeenCalledWith("ws_1");
    });

    it("propagates the authz failure when unauthenticated", async () => {
      unauthorized(401, "Please sign in.");

      const response = await GET(createRequest());

      expect(response.status).toBe(401);
      expect(mockListProviderKeys).not.toHaveBeenCalled();
    });

    it("returns 503 when the database is not configured", async () => {
      mockIsDatabaseConfigured.mockReturnValue(false);

      const response = await GET(createRequest());

      expect(response.status).toBe(503);
    });
  });

  describe("POST (save)", () => {
    it("validates the key live before saving and returns the masked summary", async () => {
      authorizedAs("ws_1");
      mockValidateProviderKey.mockResolvedValue({ ok: true });
      const now = new Date("2026-07-10T00:00:00.000Z");
      mockUpsertProviderKey.mockResolvedValue({
        provider: "openai",
        hint: "sk-…test",
        lastValidatedAt: now,
        updatedAt: now,
      });

      const response = await POST(
        createRequest({ provider: "openai", apiKey: "sk-realkeyvalue1234" }),
      );
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.key).toEqual(
        expect.objectContaining({ provider: "openai", hint: "sk-…test" }),
      );
      expect(mockValidateProviderKey).toHaveBeenCalledWith(
        "openai",
        "sk-realkeyvalue1234",
      );
      expect(mockUpsertProviderKey).toHaveBeenCalledWith({
        workspaceId: "ws_1",
        provider: "openai",
        rawKey: "sk-realkeyvalue1234",
        createdByUserId: "user_1",
      });
      expect(mockRequireGovernanceStepUp).toHaveBeenCalledWith(expect.objectContaining({ workspaceId: "ws_1", userId: "user_1", purpose: "credential.replace", resourceId: "openai" }));
      // The raw key must never appear in the response body.
      expect(JSON.stringify(data)).not.toContain("sk-realkeyvalue1234");
    });

    it("does not validate or persist a replacement without exact-scope step-up", async () => {
      authorizedAs("ws_1");
      mockRequireGovernanceStepUp.mockResolvedValueOnce(NextResponse.json({ success: false, code: "GOVERNANCE_STEP_UP_REQUIRED" }, { status: 403 }));
      const response = await POST(createRequest({ provider: "openai", apiKey: "sk-realkeyvalue1234" }));
      expect(response.status).toBe(403);
      expect(mockValidateProviderKey).not.toHaveBeenCalled();
      expect(mockUpsertProviderKey).not.toHaveBeenCalled();
    });

    it("rejects an invalid key with the provider's error, and does not persist it", async () => {
      authorizedAs("ws_1");
      mockValidateProviderKey.mockResolvedValue({
        ok: false,
        error: "Incorrect API key provided.",
      });

      const response = await POST(
        createRequest({ provider: "openai", apiKey: "sk-bad" }),
      );
      const data = await response.json();

      expect(response.status).toBe(422);
      expect(data.success).toBe(false);
      expect(data.error).toBe("Incorrect API key provided.");
      expect(mockUpsertProviderKey).not.toHaveBeenCalled();
    });

    it("rejects an unknown provider with 400", async () => {
      authorizedAs("ws_1");

      const response = await POST(
        createRequest({ provider: "not-a-real-provider", apiKey: "abc" }),
      );
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.success).toBe(false);
      expect(mockValidateProviderKey).not.toHaveBeenCalled();
      expect(mockUpsertProviderKey).not.toHaveBeenCalled();
    });

    it("rejects a missing apiKey with 400", async () => {
      authorizedAs("ws_1");

      const response = await POST(createRequest({ provider: "openai" }));

      expect(response.status).toBe(400);
      expect(mockValidateProviderKey).not.toHaveBeenCalled();
    });

    it("propagates the authz failure for non-writers", async () => {
      unauthorized(403, "You do not have access to this workspace.");

      const response = await POST(
        createRequest({ provider: "openai", apiKey: "sk-x" }),
      );

      expect(response.status).toBe(403);
      expect(mockValidateProviderKey).not.toHaveBeenCalled();
      expect(mockUpsertProviderKey).not.toHaveBeenCalled();
    });
  });
});
