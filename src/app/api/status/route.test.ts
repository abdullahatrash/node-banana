import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  databaseConfigured: vi.fn(),
  publicIncidents: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  isDatabaseConfigured: () => mocks.databaseConfigured(),
}));
vi.mock("@/lib/release-control/production", () => ({
  getReleaseControlService: () => ({ publicIncidents: mocks.publicIncidents }),
}));

import { GET } from "./route";

describe("public status API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    mocks.databaseConfigured.mockReturnValue(true);
  });

  it("treats an omitted public status workspace as an intentionally disabled capability", async () => {
    vi.stubEnv("PUBLIC_STATUS_WORKSPACE_ID", "");

    const response = await GET(new NextRequest("http://localhost/api/status?locale=ar"));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      success: true,
      configured: false,
      status: "unknown",
      incidents: [],
    });
    expect(mocks.publicIncidents).not.toHaveBeenCalled();
  });

  it("keeps a configured monitor failure visible as service unavailable", async () => {
    vi.stubEnv("PUBLIC_STATUS_WORKSPACE_ID", "status-workspace");
    mocks.publicIncidents.mockRejectedValue(new Error("database unavailable"));

    const response = await GET(new NextRequest("http://localhost/api/status?locale=en"));

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      success: false,
      configured: true,
      status: "unknown",
    });
  });

  it("returns localized incident state when configured", async () => {
    vi.stubEnv("PUBLIC_STATUS_WORKSPACE_ID", "status-workspace");
    mocks.publicIncidents.mockResolvedValue([]);

    const response = await GET(new NextRequest("http://localhost/api/status?locale=ar"));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      configured: true,
      status: "operational",
    });
    expect(mocks.publicIncidents).toHaveBeenCalledWith("ar", "status-workspace");
  });
});
