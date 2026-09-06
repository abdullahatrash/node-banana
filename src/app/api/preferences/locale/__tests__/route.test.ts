import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockGetAuthenticatedUser,
  mockIsDatabaseConfigured,
  mockSaveWorkspaceLocalePreference,
} = vi.hoisted(() => {
  return {
    mockGetAuthenticatedUser: vi.fn(),
    mockIsDatabaseConfigured: vi.fn(),
    mockSaveWorkspaceLocalePreference: vi.fn(),
  };
});

vi.mock("@/lib/auth/session", () => ({
  getAuthenticatedUserFromHeaders: mockGetAuthenticatedUser,
}));
vi.mock("@/lib/db", () => ({
  isDatabaseConfigured: mockIsDatabaseConfigured,
}));
vi.mock("@/lib/interface-locale/repository", () => ({
  saveWorkspaceLocalePreference: mockSaveWorkspaceLocalePreference,
}));

import { POST } from "../route";

function request(locale: unknown, workspaceId = "workspace-a") {
  return new Request("http://localhost/api/preferences/locale", {
    method: "POST",
    headers: { "content-type": "application/json", origin: "http://localhost", "x-workspace-id": workspaceId },
    body: JSON.stringify({ locale }),
  });
}

describe("POST /api/preferences/locale", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIsDatabaseConfigured.mockReturnValue(true);
    mockGetAuthenticatedUser.mockResolvedValue({ id: "user-1" });
    mockSaveWorkspaceLocalePreference.mockResolvedValue("saved");
  });

  it("rejects unsupported locale keys", async () => {
    const response = await POST(request("fr"));
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ code: "INVALID_INTERFACE_LOCALE" });
    expect(mockSaveWorkspaceLocalePreference).not.toHaveBeenCalled();
  });

  it("rejects cross-origin preference mutations", async () => {
    const crossOriginRequest = new Request("http://localhost/api/preferences/locale", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "https://attacker.example" },
      body: JSON.stringify({ locale: "en" }),
    });
    const response = await POST(crossOriginRequest);
    expect(response.status).toBe(403);
    expect(mockSaveWorkspaceLocalePreference).not.toHaveBeenCalled();
  });

  it("upserts the signed-in person's Workspace-specific durable interface locale", async () => {
    const response = await POST(request("en"));
    expect(response.status).toBe(200);
    expect(mockSaveWorkspaceLocalePreference).toHaveBeenCalledWith(expect.objectContaining({ userId: "user-1", workspaceId: "workspace-a", locale: "en" }));
    expect(response.headers.get("set-cookie")).toContain("NEXT_LOCALE=en");
    expect(response.headers.get("set-cookie")).toContain("TASMEEMAI_ACTIVE_WORKSPACE=workspace-a");
  });

  it("does not write or set a foreign Workspace when membership validation fails", async () => {
    mockSaveWorkspaceLocalePreference.mockResolvedValue("not_member");
    const response = await POST(request("en", "workspace-b"));
    expect(response.status).toBe(403);
    expect(response.headers.get("set-cookie")).toBeNull();
  });

  it("keeps cookie-only local development and signed-out switching available", async () => {
    mockGetAuthenticatedUser.mockResolvedValue(null);
    const response = await POST(request("ar"));
    expect(response.status).toBe(204);
    expect(mockSaveWorkspaceLocalePreference).not.toHaveBeenCalled();
  });
});
