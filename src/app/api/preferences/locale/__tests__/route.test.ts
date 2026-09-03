import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockGetAuthenticatedUser,
  mockIsDatabaseConfigured,
  mockOnConflictDoUpdate,
  mockValues,
  mockInsert,
} = vi.hoisted(() => {
  const mockOnConflictDoUpdate = vi.fn();
  const mockValues = vi.fn(() => ({ onConflictDoUpdate: mockOnConflictDoUpdate }));
  const mockInsert = vi.fn(() => ({ values: mockValues }));
  return {
    mockGetAuthenticatedUser: vi.fn(),
    mockIsDatabaseConfigured: vi.fn(),
    mockOnConflictDoUpdate,
    mockValues,
    mockInsert,
  };
});

vi.mock("@/lib/auth/session", () => ({
  getAuthenticatedUserFromHeaders: mockGetAuthenticatedUser,
}));
vi.mock("@/lib/db", () => ({
  isDatabaseConfigured: mockIsDatabaseConfigured,
  getDb: () => ({ insert: mockInsert }),
}));
vi.mock("@/lib/db/schema", () => ({
  userPreferences: { userId: "user_id" },
}));

import { POST } from "../route";

function request(locale: unknown) {
  return new Request("http://localhost/api/preferences/locale", {
    method: "POST",
    headers: { "content-type": "application/json", origin: "http://localhost" },
    body: JSON.stringify({ locale }),
  });
}

describe("POST /api/preferences/locale", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIsDatabaseConfigured.mockReturnValue(true);
    mockGetAuthenticatedUser.mockResolvedValue({ id: "user-1" });
  });

  it("rejects unsupported locale keys", async () => {
    const response = await POST(request("fr"));
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ code: "INVALID_INTERFACE_LOCALE" });
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it("rejects cross-origin preference mutations", async () => {
    const crossOriginRequest = new Request("http://localhost/api/preferences/locale", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "https://attacker.example" },
      body: JSON.stringify({ locale: "en" }),
    });
    const response = await POST(crossOriginRequest);
    expect(response.status).toBe(403);
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it("upserts the signed-in person's durable interface locale", async () => {
    const response = await POST(request("en"));
    expect(response.status).toBe(200);
    expect(mockValues).toHaveBeenCalledWith({ userId: "user-1", interfaceLocale: "en" });
    expect(mockOnConflictDoUpdate).toHaveBeenCalled();
    expect(response.headers.get("set-cookie")).toContain("NEXT_LOCALE=en");
  });

  it("keeps cookie-only local development and signed-out switching available", async () => {
    mockGetAuthenticatedUser.mockResolvedValue(null);
    const response = await POST(request("ar"));
    expect(response.status).toBe(204);
    expect(mockInsert).not.toHaveBeenCalled();
  });
});
