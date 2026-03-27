import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";

const mockWithApiPermission = vi.fn();
const mockCountActiveSocialWebhooks = vi.fn();
const mockCreateSocialWebhook = vi.fn();
const mockListSocialWebhooks = vi.fn();
const mockEncryptToken = vi.fn();

vi.mock("@/lib/db", () => ({
  isDatabaseConfigured: vi.fn(() => true),
}));

vi.mock("@/lib/studio/authz", () => ({
  withApiPermission: (...args: unknown[]) => mockWithApiPermission(...args),
  authzErrorResponse: (result: { status: number; error: string }) =>
    NextResponse.json({ success: false, error: result.error }, { status: result.status }),
}));

vi.mock("@/lib/social/repository", () => ({
  countActiveSocialWebhooks: (...args: unknown[]) =>
    mockCountActiveSocialWebhooks(...args),
  createSocialWebhook: (...args: unknown[]) => mockCreateSocialWebhook(...args),
  listSocialWebhooks: (...args: unknown[]) => mockListSocialWebhooks(...args),
}));

vi.mock("@/lib/social/crypto", () => ({
  encryptToken: (...args: unknown[]) => mockEncryptToken(...args),
}));

const mockSession = {
  user: { id: "user_1", name: "Test", email: "test@example.com" },
  workspace: { id: "ws_1", organizationId: "org_1" },
  role: "owner" as const,
  planTier: "free" as const,
  permissions: ["social:view", "social:manage"],
};

function authorized(planTier: "free" | "pro" | "enterprise" = "free") {
  mockWithApiPermission.mockResolvedValue({
    authorized: true,
    session: { ...mockSession, planTier },
  });
}

function unauthorized(status: 401 | 403) {
  mockWithApiPermission.mockResolvedValue({
    authorized: false,
    response: NextResponse.json(
      { success: false, error: status === 401 ? "Unauthenticated" : "Forbidden" },
      { status },
    ),
  });
}

function req(url: string, init?: RequestInit): NextRequest {
  return new NextRequest(url, init);
}

describe("/api/social/webhooks", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockEncryptToken.mockReturnValue("enc_secret");
  });

  it("returns 401 for unauthenticated requests", async () => {
    unauthorized(401);
    const { GET } = await import("../route");
    const response = await GET(req("http://localhost:3000/api/social/webhooks"));
    expect(response.status).toBe(401);
  });

  it("lists workspace webhooks without encrypted secret", async () => {
    authorized();
    mockListSocialWebhooks.mockResolvedValue([
      {
        id: "swh_1",
        workspaceId: "ws_1",
        targetUrl: "https://example.com/hook",
        signingSecretEncrypted: "enc_secret",
        enabled: true,
        createdByUserId: "user_1",
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ]);

    const { GET } = await import("../route");
    const response = await GET(req("http://localhost:3000/api/social/webhooks"));
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.webhooks[0]).not.toHaveProperty("signingSecretEncrypted");
  });

  it("creates a webhook and returns one-time signing secret", async () => {
    authorized();
    mockCountActiveSocialWebhooks.mockResolvedValue(0);
    mockCreateSocialWebhook.mockResolvedValue({
      id: "swh_1",
      workspaceId: "ws_1",
      targetUrl: "https://example.com/hook",
      signingSecretEncrypted: "enc_secret",
      enabled: true,
      createdByUserId: "user_1",
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const { POST } = await import("../route");
    const response = await POST(
      req("http://localhost:3000/api/social/webhooks", {
        method: "POST",
        body: JSON.stringify({ targetUrl: "https://example.com/hook" }),
      }),
    );
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.signingSecret).toBeTypeOf("string");
    expect(mockCreateSocialWebhook).toHaveBeenCalledWith({
      workspaceId: "ws_1",
      targetUrl: "https://example.com/hook",
      signingSecretEncrypted: "enc_secret",
      createdByUserId: "user_1",
    });
  });

  it("returns 402 when webhook quota is exceeded", async () => {
    authorized("free");
    mockCountActiveSocialWebhooks.mockResolvedValue(1);

    const { POST } = await import("../route");
    const response = await POST(
      req("http://localhost:3000/api/social/webhooks", {
        method: "POST",
        body: JSON.stringify({ targetUrl: "https://example.com/hook" }),
      }),
    );
    const data = await response.json();

    expect(response.status).toBe(402);
    expect(data.code).toBe("quota_exceeded");
    expect(data.section).toBe("webhooks");
  });
});
