import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";

const mockAuthorizeStudioRequest = vi.fn();
const mockGetPrompt = vi.fn();
const mockUpdatePrompt = vi.fn();
const mockSoftDeletePrompt = vi.fn();

vi.mock("@/lib/db", () => ({
  isDatabaseConfigured: vi.fn(() => true),
}));

vi.mock("@/lib/studio/authz", () => ({
  authorizeStudioRequest: (...args: unknown[]) => mockAuthorizeStudioRequest(...args),
  authzErrorResponse: (result: { status: number; error: string }) =>
    NextResponse.json(
      { success: false, error: result.error },
      { status: result.status },
    ),
}));

vi.mock("@/lib/studio/repository", () => ({
  getPrompt: (...args: unknown[]) => mockGetPrompt(...args),
  updatePrompt: (...args: unknown[]) => mockUpdatePrompt(...args),
  softDeletePrompt: (...args: unknown[]) => mockSoftDeletePrompt(...args),
}));

vi.mock("@/utils/logger", () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));

import { PATCH, DELETE } from "../route";

const authorizedResult = {
  authorized: true as const,
  workspaceId: "ws_test",
  userId: "user_test",
  role: "owner" as const,
  permissions: [] as never[],
  contentSession: {} as never,
};

function createPatchRequest(body: unknown): NextRequest {
  return {
    headers: new Headers(),
    json: vi.fn().mockResolvedValue(body),
  } as unknown as NextRequest;
}

function createDeleteRequest(): NextRequest {
  return {
    headers: new Headers(),
  } as unknown as NextRequest;
}

function makeContext(promptId: string) {
  return { params: Promise.resolve({ promptId }) };
}

describe("/api/studio/prompts/[promptId] PATCH", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuthorizeStudioRequest.mockResolvedValue(authorizedResult);
  });

  it("returns 401 for unauthenticated requests", async () => {
    mockAuthorizeStudioRequest.mockResolvedValue({
      authorized: false,
      status: 401,
      error: "Please sign in to access AI Studio.",
      reason: "unauthenticated",
    });

    const response = await PATCH(
      createPatchRequest({ name: "New name" }),
      makeContext("sp_1"),
    );
    expect(response.status).toBe(401);
  });

  it("returns 400 when name is empty string", async () => {
    const response = await PATCH(
      createPatchRequest({ name: "" }),
      makeContext("sp_1"),
    );
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.success).toBe(false);
    expect(data.error).toContain("name");
  });

  it("returns 400 when name is whitespace only", async () => {
    const response = await PATCH(
      createPatchRequest({ name: "   " }),
      makeContext("sp_1"),
    );
    expect(response.status).toBe(400);
  });

  it("returns 400 when isPublic is not a boolean", async () => {
    mockGetPrompt.mockResolvedValue({ id: "sp_1", name: "Existing" });

    const response = await PATCH(
      createPatchRequest({ isPublic: "yes" }),
      makeContext("sp_1"),
    );
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toContain("isPublic");
  });

  it("returns 400 when promptText is empty string", async () => {
    const response = await PATCH(
      createPatchRequest({ promptText: "" }),
      makeContext("sp_1"),
    );
    expect(response.status).toBe(400);
  });

  it("returns 400 when formConfig is an array", async () => {
    mockGetPrompt.mockResolvedValue({ id: "sp_1", name: "Existing" });

    const response = await PATCH(
      createPatchRequest({ formConfig: [1, 2, 3] }),
      makeContext("sp_1"),
    );
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toContain("formConfig");
  });

  it("returns 404 when prompt does not exist", async () => {
    mockGetPrompt.mockResolvedValue(null);

    const response = await PATCH(
      createPatchRequest({ name: "New name" }),
      makeContext("sp_missing"),
    );
    const data = await response.json();

    expect(response.status).toBe(404);
    expect(data.error).toBe("Prompt not found.");
  });

  it("calls updatePrompt with only the four allowed keys (trimmed strings)", async () => {
    mockGetPrompt.mockResolvedValue({ id: "sp_1", name: "Existing" });
    mockUpdatePrompt.mockResolvedValue({ id: "sp_1", name: "Updated Name" });

    const response = await PATCH(
      createPatchRequest({
        name: "  Updated Name  ",
        isPublic: true,
        formConfig: { aspectRatio: "1:1" },
      }),
      makeContext("sp_1"),
    );
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(mockUpdatePrompt).toHaveBeenCalledWith("ws_test", "sp_1", {
      name: "Updated Name",
      promptText: undefined,
      formConfig: { aspectRatio: "1:1" },
      isPublic: true,
    });
  });
});

describe("/api/studio/prompts/[promptId] DELETE", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuthorizeStudioRequest.mockResolvedValue(authorizedResult);
  });

  it("returns 404 when prompt does not exist", async () => {
    mockSoftDeletePrompt.mockResolvedValue(null);

    const response = await DELETE(createDeleteRequest(), makeContext("sp_missing"));
    const data = await response.json();

    expect(response.status).toBe(404);
    expect(data.error).toBe("Prompt not found.");
  });

  it("soft-deletes prompt and returns success", async () => {
    const deleted = { id: "sp_1", name: "My Prompt" };
    mockSoftDeletePrompt.mockResolvedValue(deleted);

    const response = await DELETE(createDeleteRequest(), makeContext("sp_1"));
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.prompt).toEqual(deleted);
    expect(mockSoftDeletePrompt).toHaveBeenCalledWith("ws_test", "sp_1");
  });
});
