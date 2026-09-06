import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";

const authorize = vi.fn();
const entitlement = vi.fn();
const accounts = vi.fn();
const providers = vi.fn();
vi.mock("@/lib/db", () => ({ isDatabaseConfigured: () => true }));
vi.mock("@/lib/social/runtime-bootstrap", () => ({}));
vi.mock("@/lib/studio/authz", () => ({
  authorizeStudioRequest: (...args: unknown[]) => authorize(...args),
  authzErrorResponse: (result: { status: number; error: string }) => NextResponse.json({ success: false, error: result.error }, { status: result.status }),
}));
vi.mock("@/lib/commercial/channel-entitlement", () => ({ getWorkspaceChannelEntitlement: (...args: unknown[]) => entitlement(...args) }));
vi.mock("@/lib/social/repository", () => ({ listSocialAccounts: (...args: unknown[]) => accounts(...args) }));
vi.mock("@/lib/social/provider-registry", () => ({ listProviderCapabilities: () => providers() }));

import { GET } from "./route";

describe("GET /api/social/channels/summary", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns the authorized Workspace allowance, health, and provider readiness", async () => {
    authorize.mockResolvedValue({ authorized: true, userId: "user-1", workspaceId: "workspace-1", role: "member" });
    entitlement.mockResolvedValue({ planId: "starter", planVersion: 1, subscriptionState: "trialing", authoredName: { ar: "البداية", en: "Starter" }, connectedChannels: 5 });
    accounts.mockResolvedValue([
      { platform: "instagram", disabled: false, requiresReauth: false },
      { platform: "instagram", disabled: false, requiresReauth: true },
      { platform: "linkedin", disabled: true, requiresReauth: false },
    ]);
    providers.mockReturnValue([
      { identifier: "instagram", displayName: "Instagram", configured: true, supportsImages: true, supportsVideo: true, supportsCarousel: true, supportsPostMetrics: true },
      { identifier: "x", displayName: "X", configured: false, supportsImages: true, supportsVideo: true, supportsCarousel: false },
    ]);

    const response = await GET(new NextRequest("http://localhost/api/social/channels/summary"), undefined);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(entitlement).toHaveBeenCalledWith("workspace-1");
    expect(accounts).toHaveBeenCalledWith("workspace-1");
    expect(body.data.usage).toEqual({ active: 2, healthy: 1, requiresReauth: 1, disabled: 1, remaining: 3 });
    expect(body.data.providers).toEqual(expect.arrayContaining([
      expect.objectContaining({ identifier: "instagram", connected: 2, configured: true, supportsPostMetrics: true }),
      expect.objectContaining({ identifier: "x", connected: 0, configured: false, supportsPostMetrics: false }),
    ]));
  });

  it("rejects unauthenticated access", async () => {
    authorize.mockResolvedValue({ authorized: false, status: 401, error: "Sign in", reason: "unauthenticated" });
    expect((await GET(new NextRequest("http://localhost/api/social/channels/summary"), undefined)).status).toBe(401);
    expect(accounts).not.toHaveBeenCalled();
  });
});
