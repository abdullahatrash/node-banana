import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";

const mockWithApiPermission = vi.fn();
const mockGetSocialWebhook = vi.fn();
const mockDeleteSocialWebhook = vi.fn();
const mockListWebhookDeliveriesForWorkspace = vi.fn();
const mockUpdateSocialWebhook = vi.fn();
const mockListSocialWebhookSubscriptions = vi.fn();
const mockUpdateSocialWebhookSubscription = vi.fn();

vi.mock("@/lib/db", () => ({
  isDatabaseConfigured: vi.fn(() => true),
}));

vi.mock("@/lib/studio/authz", () => ({
  withApiPermission: (...args: unknown[]) => mockWithApiPermission(...args),
  authzErrorResponse: (result: { status: number; error: string }) =>
    NextResponse.json({ success: false, error: result.error }, { status: result.status }),
}));

vi.mock("@/lib/social/repository", () => ({
  getSocialWebhook: (...args: unknown[]) => mockGetSocialWebhook(...args),
  deleteSocialWebhook: (...args: unknown[]) => mockDeleteSocialWebhook(...args),
  updateSocialWebhook: (...args: unknown[]) => mockUpdateSocialWebhook(...args),
  listSocialWebhookSubscriptions: (...args: unknown[]) =>
    mockListSocialWebhookSubscriptions(...args),
  updateSocialWebhookSubscription: (...args: unknown[]) =>
    mockUpdateSocialWebhookSubscription(...args),
  listWebhookDeliveriesForWorkspace: (...args: unknown[]) =>
    mockListWebhookDeliveriesForWorkspace(...args),
  SocialWebhookNotFoundError: class extends Error {
    constructor(id?: string) {
      super(`Social webhook "${id}" not found.`);
      this.name = "SocialWebhookNotFoundError";
    }
  },
  SocialWebhookSubscriptionNotFoundError: class extends Error {
    constructor(id?: string) {
      super(`Social webhook subscription "${id}" not found.`);
      this.name = "SocialWebhookSubscriptionNotFoundError";
    }
  },
}));

const mockSession = {
  user: { id: "user_1", name: "Test", email: "test@example.com" },
  workspace: { id: "ws_1", organizationId: "org_1" },
  role: "owner" as const,
  planTier: "free" as const,
  permissions: ["social:view", "social:manage"],
};

function authorized() {
  mockWithApiPermission.mockResolvedValue({ authorized: true, session: mockSession });
}

function req(url: string, init?: RequestInit): NextRequest {
  return new NextRequest(url, init as ConstructorParameters<typeof NextRequest>[1]);
}

describe("/api/social/webhooks/[webhookId]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns webhook details and delivery history", async () => {
    authorized();
    mockGetSocialWebhook.mockResolvedValue({
      id: "swh_1",
      workspaceId: "ws_1",
      targetUrl: "https://example.com/hook",
      signingSecretEncrypted: "enc_secret",
      enabled: true,
      createdByUserId: "user_1",
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    mockListWebhookDeliveriesForWorkspace.mockResolvedValue([
      { id: "swhd_1", status: "success", eventType: "post.published" },
    ]);

    const { GET } = await import("../route");
    const response = await GET(
      req("http://localhost:3000/api/social/webhooks/swh_1"),
      { params: Promise.resolve({ webhookId: "swh_1" }) },
    );
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.webhook).not.toHaveProperty("signingSecretEncrypted");
    expect(data.deliveries).toHaveLength(1);
    expect(mockListWebhookDeliveriesForWorkspace).toHaveBeenCalledWith("ws_1", {
      webhookId: "swh_1",
      limit: 100,
    });
  });

  it("deletes webhook", async () => {
    authorized();
    mockDeleteSocialWebhook.mockResolvedValue({});

    const { DELETE } = await import("../route");
    const response = await DELETE(
      req("http://localhost:3000/api/social/webhooks/swh_1", { method: "DELETE" }),
      { params: Promise.resolve({ webhookId: "swh_1" }) },
    );

    expect(response.status).toBe(200);
    expect(mockDeleteSocialWebhook).toHaveBeenCalledWith("ws_1", "swh_1");
  });

  it("updates webhook enabled flag", async () => {
    authorized();
    mockUpdateSocialWebhook.mockResolvedValue({
      id: "swh_1",
      workspaceId: "ws_1",
      targetUrl: "https://example.com/hook",
      signingSecretEncrypted: "enc_secret",
      enabled: false,
      createdByUserId: "user_1",
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const { PATCH } = await import("../route");
    const response = await PATCH(
      req("http://localhost:3000/api/social/webhooks/swh_1", {
        method: "PATCH",
        body: JSON.stringify({ enabled: false }),
      }),
      { params: Promise.resolve({ webhookId: "swh_1" }) },
    );
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(mockUpdateSocialWebhook).toHaveBeenCalledWith("ws_1", "swh_1", {
      enabled: false,
    });
  });
});
