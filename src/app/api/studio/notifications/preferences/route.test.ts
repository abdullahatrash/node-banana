import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({ auth: vi.fn(), get: vi.fn(), update: vi.fn() }));
vi.mock("@/lib/studio/authz", () => ({ withApiPermission: (...args: unknown[]) => mocks.auth(...args) }));
vi.mock("@/lib/product-notifications/production", () => ({ WORKSPACE_NOTIFICATIONS: { getPreferences: (...args: unknown[]) => mocks.get(...args), updatePreferences: (...args: unknown[]) => mocks.update(...args) } }));

import { GET, PUT } from "./route";

describe("workspace notification preferences route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.auth.mockResolvedValue({ authorized: true, session: { workspace: { id: "ws_1" }, user: { id: "user_1" } } });
    mocks.get.mockResolvedValue({ deliveryLocale: null, billingEmailEnabled: true, channelEmailEnabled: true, publishingEmailEnabled: true, creditEmailEnabled: true });
    mocks.update.mockImplementation(async (value) => value);
  });

  it("loads personal workspace-scoped product notification preferences", async () => {
    const response = await GET(new NextRequest("http://localhost/api/studio/notifications/preferences"));
    expect(response.status).toBe(200);
    expect(mocks.get).toHaveBeenCalledWith("ws_1", "user_1");
  });

  it("accepts only the explicit bilingual operational-email preference contract", async () => {
    const preferences = { deliveryLocale: "ar", billingEmailEnabled: false, channelEmailEnabled: true, publishingEmailEnabled: false, creditEmailEnabled: true };
    const response = await PUT(new NextRequest("http://localhost/api/studio/notifications/preferences", { method: "PUT", body: JSON.stringify(preferences) }));
    expect(response.status).toBe(200);
    expect(mocks.update).toHaveBeenCalledWith({ workspaceId: "ws_1", userId: "user_1", ...preferences });
    const invalid = await PUT(new NextRequest("http://localhost/api/studio/notifications/preferences", { method: "PUT", body: JSON.stringify({ ...preferences, deliveryLocale: "fr" }) }));
    expect(invalid.status).toBe(422);
    const partial = await PUT(new NextRequest("http://localhost/api/studio/notifications/preferences", { method: "PUT", body: JSON.stringify({ deliveryLocale: "ar", billingEmailEnabled: true }) }));
    expect(partial.status).toBe(422);
    const unknown = await PUT(new NextRequest("http://localhost/api/studio/notifications/preferences", { method: "PUT", body: JSON.stringify({ ...preferences, extra: true }) }));
    expect(unknown.status).toBe(422);
  });
});
