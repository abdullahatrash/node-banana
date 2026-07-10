import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mockListDueWebhookDeliveries = vi.fn();
const mockClaimWebhookDelivery = vi.fn();
const mockMarkWebhookDeliverySuccess = vi.fn();
const mockMarkWebhookDeliveryPendingRetry = vi.fn();
const mockMarkWebhookDeliveryFailed = vi.fn();
const mockCreateSocialWebhookDeliveryDeadLetter = vi.fn();
const mockDecryptToken = vi.fn();
const mockCreateWebhookSignature = vi.fn();

vi.mock("@/lib/db", () => ({
  isDatabaseConfigured: vi.fn(() => true),
}));

vi.mock("@/lib/social/repository", () => ({
  listDueWebhookDeliveries: (...args: unknown[]) => mockListDueWebhookDeliveries(...args),
  claimWebhookDelivery: (...args: unknown[]) => mockClaimWebhookDelivery(...args),
  markWebhookDeliverySuccess: (...args: unknown[]) => mockMarkWebhookDeliverySuccess(...args),
  markWebhookDeliveryPendingRetry: (...args: unknown[]) =>
    mockMarkWebhookDeliveryPendingRetry(...args),
  markWebhookDeliveryFailed: (...args: unknown[]) => mockMarkWebhookDeliveryFailed(...args),
  createSocialWebhookDeliveryDeadLetter: (...args: unknown[]) =>
    mockCreateSocialWebhookDeliveryDeadLetter(...args),
}));

vi.mock("@/lib/social/crypto", () => ({
  decryptToken: (...args: unknown[]) => mockDecryptToken(...args),
}));

vi.mock("@/lib/social/webhook-signing", () => ({
  createWebhookSignature: (...args: unknown[]) => mockCreateWebhookSignature(...args),
}));

vi.mock("@/utils/logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

function createRequest(headers?: Record<string, string>): NextRequest {
  return new NextRequest("http://localhost:3000/api/social/internal/webhook-delivery", {
    method: "POST",
    headers,
  });
}

describe("/api/social/internal/webhook-delivery POST", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.SOCIAL_INTERNAL_API_SECRET = "secret_123";
    delete process.env.SOCIAL_WEBHOOK_DELIVERY_MAX_ATTEMPTS;
    mockDecryptToken.mockReturnValue("plain_secret");
    mockCreateWebhookSignature.mockReturnValue("sig_123");
    vi.stubGlobal("fetch", vi.fn());
  });

  it("returns 401 for missing auth", async () => {
    const { POST } = await import("../route");
    const response = await POST(createRequest());
    expect(response.status).toBe(401);
  });

  it("delivers due webhooks successfully", async () => {
    mockListDueWebhookDeliveries.mockResolvedValue([
      {
        deliveryId: "swhd_1",
        workspaceId: "ws_1",
        webhookId: "swh_1",
        eventId: "sevt_1",
        attemptCount: 0,
        targetUrl: "https://example.com/hook",
        signingSecretEncrypted: "enc_secret",
        eventType: "post.published",
        message: "Published",
        userFacing: false,
        severity: "info",
        postId: "spost_1",
        accountId: "sacct_1",
        provider: "linkedin",
        dispatchKey: "dispatch:spost_1",
        workflowRunRef: "run_1",
        metadata: {},
        eventCreatedAt: new Date(),
      },
    ]);
    mockClaimWebhookDelivery.mockResolvedValue({ attemptCount: 1 });
    (global.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response("ok", { status: 200 }),
    );

    const { POST } = await import("../route");
    const response = await POST(
      createRequest({ "x-social-internal-secret": "secret_123" }),
    );
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.summary).toEqual({
      scanned: 1,
      delivered: 1,
      retried: 0,
      failed: 0,
      skipped: 0,
    });
    expect(mockMarkWebhookDeliverySuccess).toHaveBeenCalledWith({
      deliveryId: "swhd_1",
      responseStatus: 200,
      responseBody: "ok",
    });
  });

  it("schedules retry for non-2xx response before max attempts", async () => {
    process.env.SOCIAL_WEBHOOK_DELIVERY_MAX_ATTEMPTS = "3";
    mockListDueWebhookDeliveries.mockResolvedValue([
      {
        deliveryId: "swhd_1",
        workspaceId: "ws_1",
        webhookId: "swh_1",
        eventId: "sevt_1",
        attemptCount: 1,
        targetUrl: "https://example.com/hook",
        signingSecretEncrypted: "enc_secret",
        eventType: "post.failed",
        message: "Failed",
        userFacing: true,
        severity: "error",
        postId: "spost_1",
        accountId: "sacct_1",
        provider: "linkedin",
        dispatchKey: "dispatch:spost_1",
        workflowRunRef: "run_1",
        metadata: {},
        eventCreatedAt: new Date(),
      },
    ]);
    mockClaimWebhookDelivery.mockResolvedValue({ attemptCount: 2 });
    (global.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response("bad request", { status: 400 }),
    );

    const { POST } = await import("../route");
    const response = await POST(
      createRequest({ "x-social-internal-secret": "secret_123" }),
    );
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.summary.retried).toBe(1);
    expect(mockMarkWebhookDeliveryPendingRetry).toHaveBeenCalledWith({
      deliveryId: "swhd_1",
      nextAttemptAt: expect.any(Date),
      responseStatus: 400,
      responseBody: "bad request",
      lastError: "Webhook responded with status 400.",
    });
  });

  it("moves a webhook delivery to dead letter state at max attempts", async () => {
    process.env.SOCIAL_WEBHOOK_DELIVERY_MAX_ATTEMPTS = "2";
    mockListDueWebhookDeliveries.mockResolvedValue([
      {
        deliveryId: "swhd_1",
        workspaceId: "ws_1",
        webhookId: "swh_1",
        eventId: "sevt_1",
        attemptCount: 2,
        targetUrl: "https://example.com/hook",
        signingSecretEncrypted: "enc_secret",
        eventType: "post.failed",
        message: "Failed",
        userFacing: true,
        severity: "error",
        postId: "spost_1",
        accountId: "sacct_1",
        provider: "linkedin",
        dispatchKey: "dispatch:spost_1",
        workflowRunRef: "run_1",
        metadata: {},
        eventCreatedAt: new Date(),
      },
    ]);
    mockClaimWebhookDelivery.mockResolvedValue({ attemptCount: 3 });
    (global.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response("dead letter", { status: 500 }),
    );

    const { POST } = await import("../route");
    const response = await POST(
      createRequest({ "x-social-internal-secret": "secret_123" }),
    );
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.summary).toEqual({
      scanned: 1,
      delivered: 0,
      retried: 0,
      failed: 1,
      skipped: 0,
    });
    expect(mockMarkWebhookDeliveryFailed).toHaveBeenCalledWith({
      deliveryId: "swhd_1",
      responseStatus: 500,
      responseBody: "dead letter",
      lastError: "Webhook responded with status 500.",
    });
    expect(mockCreateSocialWebhookDeliveryDeadLetter).toHaveBeenCalledWith({
      workspaceId: "ws_1",
      deliveryId: "swhd_1",
      webhookId: "swh_1",
      eventId: "sevt_1",
      deadLetterReason: "status_500",
      responseStatus: 500,
      responseBody: "dead letter",
    });
  });

  it("supports GET as a cron-triggered webhook delivery", async () => {
    mockListDueWebhookDeliveries.mockResolvedValue([]);

    const { GET } = await import("../route");
    const response = await GET(
      createRequest({ "x-social-internal-secret": "secret_123" }),
    );
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
  });
});
