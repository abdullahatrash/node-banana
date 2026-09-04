import { describe, expect, it, vi, beforeEach } from "vitest";
import { NextRequest, NextResponse } from "next/server";

const mockIsDatabaseConfigured = vi.fn(() => true);
const mockAuthorizeStudioRequest = vi.fn();
const mockRecordSafeOperationalTrace = vi.fn<
  (input: unknown) => Promise<string | null>
>(
  async (_input: unknown) => "otr_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
);

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

vi.mock("@/lib/agent-runtime/safe-diagnostics", () => ({
  recordSafeOperationalTrace: (input: unknown) =>
    mockRecordSafeOperationalTrace(input),
}));

import { withStudioAuth } from "@/lib/studio/withStudioAuth";

function createRequest(): NextRequest {
  return {
    headers: new Headers(),
  } as unknown as NextRequest;
}

const authorizedResult = {
  authorized: true as const,
  userId: "user_1",
  workspaceId: "ws_1",
  role: "member" as const,
  permissions: [] as never[],
  contentSession: {} as never,
};

describe("withStudioAuth", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIsDatabaseConfigured.mockReturnValue(true);
    mockRecordSafeOperationalTrace.mockResolvedValue(
      "otr_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    );
  });

  it("returns 503 when database is not configured (handler not called)", async () => {
    mockIsDatabaseConfigured.mockReturnValue(false);
    const handler = vi.fn();

    const route = withStudioAuth({ route: "/api/studio/test", action: "read" }, handler);
    const response = await route(createRequest(), undefined as never);
    const data = await response.json();

    expect(response.status).toBe(503);
    expect(data.success).toBe(false);
    expect(data.error).toBe("DATABASE_URL is not configured.");
    expect(handler).not.toHaveBeenCalled();
  });

  it("returns 401 pass-through from authorizeStudioRequest failure", async () => {
    mockAuthorizeStudioRequest.mockResolvedValue({
      authorized: false,
      status: 401,
      error: "Please sign in to access AI Studio.",
      reason: "unauthenticated",
    });
    const handler = vi.fn();

    const route = withStudioAuth({ route: "/api/studio/test", action: "read" }, handler);
    const response = await route(createRequest(), undefined as never);
    const data = await response.json();

    expect(response.status).toBe(401);
    expect(data.success).toBe(false);
    expect(data.error).toBe("Please sign in to access AI Studio.");
    expect(handler).not.toHaveBeenCalled();
  });

  it("returns 403 pass-through from authorizeStudioRequest failure", async () => {
    mockAuthorizeStudioRequest.mockResolvedValue({
      authorized: false,
      status: 403,
      error: "No access to this workspace.",
      reason: "forbidden",
    });
    const handler = vi.fn();

    const route = withStudioAuth({ route: "/api/studio/test", action: "read" }, handler);
    const response = await route(createRequest(), undefined as never);
    const data = await response.json();

    expect(response.status).toBe(403);
    expect(data.success).toBe(false);
    expect(handler).not.toHaveBeenCalled();
  });

  it("calls handler with narrowed authz result and returns its response", async () => {
    mockAuthorizeStudioRequest.mockResolvedValue(authorizedResult);
    const handlerResponse = NextResponse.json({ success: true, data: "ok" });
    const handler = vi.fn().mockResolvedValue(handlerResponse);

    const route = withStudioAuth({ route: "/api/studio/test", action: "read" }, handler);
    const request = createRequest();
    const response = await route(request, undefined as never);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(handler).toHaveBeenCalledWith(request, authorizedResult, undefined);
  });

  it("forwards an exact product capability instead of inferring Workspace mutation", async () => {
    mockAuthorizeStudioRequest.mockResolvedValue(authorizedResult);
    const route = withStudioAuth(
      { route: "/api/product-support/submit", action: "write", permission: "product:support:submit" },
      vi.fn().mockResolvedValue(NextResponse.json({ success: true })),
    );
    const request = createRequest();
    await route(request, undefined as never);
    expect(mockAuthorizeStudioRequest).toHaveBeenCalledWith(request, {
      route: "/api/product-support/submit",
      action: "write",
      permission: "product:support:submit",
    });
  });

  it("returns 500 with generic message when handler throws (not leaking error.message)", async () => {
    mockAuthorizeStudioRequest.mockResolvedValue(authorizedResult);
    const canary =
      "PROMPT_CANARY Authorization: Bearer token Cookie=secret https://signed.example/private";
    const handler = vi.fn().mockRejectedValue(new Error(canary));
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    const route = withStudioAuth({ route: "/api/studio/test", action: "write" }, handler);
    const response = await route(createRequest(), undefined as never);
    const data = await response.json();

    expect(response.status).toBe(500);
    expect(data.success).toBe(false);
    expect(data.error).toBe("Internal server error.");
    expect(data.code).toBe("STUDIO_ROUTE_UNAVAILABLE");
    expect(data.operatorTraceRef).toBe("otr_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(JSON.stringify(data)).not.toContain(canary);
    expect(JSON.stringify(mockRecordSafeOperationalTrace.mock.calls)).not.toContain(canary);
    expect(JSON.stringify(consoleError.mock.calls)).not.toContain(canary);
    expect(mockRecordSafeOperationalTrace).toHaveBeenCalledWith({
      workspaceId: "ws_1",
      category: "runtime",
      severity: "error",
      code: "STUDIO_ROUTE_UNAVAILABLE",
      stage: "execution",
      outcome: "failed",
      providerFamily: "internal",
      httpStatus: null,
      retryable: true,
      durationMs: null,
      attempt: null,
      createdAt: expect.any(Date),
    });
    consoleError.mockRestore();
  });

  it("returns a null trace reference when no sanitized diagnostic was persisted", async () => {
    mockAuthorizeStudioRequest.mockResolvedValue(authorizedResult);
    mockRecordSafeOperationalTrace.mockResolvedValue(null);
    const handler = vi.fn().mockRejectedValue(new Error("private failure"));

    const route = withStudioAuth(
      { route: "/api/studio/test", action: "write" },
      handler,
    );
    const response = await route(createRequest(), undefined as never);

    await expect(response.json()).resolves.toMatchObject({
      success: false,
      code: "STUDIO_ROUTE_UNAVAILABLE",
      operatorTraceRef: null,
    });
  });

  it("forwards context to the handler for dynamic routes", async () => {
    mockAuthorizeStudioRequest.mockResolvedValue(authorizedResult);
    const handlerResponse = NextResponse.json({ success: true });
    const handler = vi.fn().mockResolvedValue(handlerResponse);

    const context = { params: Promise.resolve({ assetId: "asset_abc" }) };
    const route = withStudioAuth<typeof context>(
      { route: "/api/studio/assets/[assetId]", action: "read" },
      handler,
    );

    const request = createRequest();
    await route(request, context);

    expect(handler).toHaveBeenCalledWith(request, authorizedResult, context);
  });
});
