import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  SocialEventNotFoundError,
  markSocialEventRead,
  claimWebhookDelivery,
  markWebhookDeliveryFailed,
  markWebhookDeliveryPendingRetry,
  recordSocialEvent,
} from "@/lib/social/repository";

const mockDb = {
  transaction: vi.fn(),
  update: vi.fn(),
};

const mockTx = {
  insert: vi.fn(),
  select: vi.fn(),
};

vi.mock("@/lib/db", () => ({
  getDb: () => mockDb,
}));

vi.mock("@/lib/db/schema", () => ({
  socialEvents: {
    workspaceId: "workspace_id",
    id: "id",
    eventType: "event_type",
    severity: "severity",
    message: "message",
    userFacing: "user_facing",
    readAt: "read_at",
    postId: "post_id",
    accountId: "account_id",
    provider: "provider",
    dispatchKey: "dispatch_key",
    workflowRunRef: "workflow_run_ref",
    metadata: "metadata",
    createdByUserId: "created_by_user_id",
    createdAt: "created_at",
  },
  socialWebhookDeliveries: {
    id: "id",
    workspaceId: "workspace_id",
    webhookId: "webhook_id",
    eventId: "event_id",
    status: "status",
    attemptCount: "attempt_count",
    nextAttemptAt: "next_attempt_at",
    lastAttemptAt: "last_attempt_at",
    deliveredAt: "delivered_at",
    responseStatus: "response_status",
    responseBody: "response_body",
    lastError: "last_error",
    lockedAt: "locked_at",
    createdAt: "created_at",
    updatedAt: "updated_at",
  },
  socialWebhooks: {
    id: "id",
    workspaceId: "workspace_id",
    enabled: "enabled",
    targetUrl: "target_url",
    signingSecretEncrypted: "signing_secret_encrypted",
  },
  socialWebhookSubscriptions: {
    id: "id",
    workspaceId: "workspace_id",
    webhookId: "webhook_id",
    enabled: "enabled",
    filters: "filters",
    createdByUserId: "created_by_user_id",
    createdAt: "created_at",
    updatedAt: "updated_at",
  },
}));

function mockTxInsertResult(rows: unknown[]) {
  const returning = vi.fn().mockResolvedValue(rows);
  const values = vi.fn().mockReturnValue({ returning });
  mockTx.insert.mockReturnValue({ values });
  return returning;
}

function mockTxSelectResult(rows: unknown[]) {
  const where = vi.fn().mockResolvedValue(rows);
  const innerJoin = vi.fn().mockReturnValue({ where });
  const from = vi.fn().mockReturnValue({ where, innerJoin });
  mockTx.select.mockReturnValue({ from });
  return where;
}

function mockDbUpdateResult(rows: unknown[]) {
  const returning = vi.fn().mockResolvedValue(rows);
  const where = vi.fn().mockReturnValue({ returning });
  const set = vi.fn().mockReturnValue({ where });
  mockDb.update.mockReturnValue({ set });
  return { returning, where, set };
}

describe("social/repository primitives", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDb.transaction.mockImplementation(async (callback: (tx: typeof mockTx) => unknown) =>
      callback(mockTx),
    );
  });

  it("records a social event and queues webhook deliveries", async () => {
    mockTxInsertResult([{ id: "sevt_1", workspaceId: "ws_1" }]);
    const whereSubscriptions = vi.fn().mockResolvedValue([]);
    const innerJoinSubscriptions = vi
      .fn()
      .mockReturnValue({ where: whereSubscriptions });
    const fromSubscriptions = vi
      .fn()
      .mockReturnValue({ innerJoin: innerJoinSubscriptions });
    const whereWebhooks = vi
      .fn()
      .mockResolvedValue([{ id: "swh_1" }, { id: "swh_2" }]);
    const fromWebhooks = vi.fn().mockReturnValue({ where: whereWebhooks });
    mockTx.select
      .mockReturnValueOnce({
        from: fromSubscriptions,
      })
      .mockReturnValueOnce({
        from: fromWebhooks,
      });

    const result = await recordSocialEvent({
      workspaceId: "ws_1",
      eventType: "post.published",
      message: "Published",
      userFacing: true,
      postId: "spost_1",
      accountId: "sacct_1",
      provider: "linkedin",
      dispatchKey: "dispatch:spost_1",
      workflowRunRef: "run_1",
      metadata: { source: "test" },
    });

    expect(result.queuedWebhookDeliveries).toBe(2);
    expect(result.event).toEqual({ id: "sevt_1", workspaceId: "ws_1" });
    expect(mockDb.transaction).toHaveBeenCalledTimes(1);
    expect(mockTx.insert).toHaveBeenCalledTimes(2);
    expect(mockTx.select).toHaveBeenCalledTimes(2);
  });

  it("marks an event as read within the workspace scope", async () => {
    const readAt = new Date("2026-03-27T12:00:00.000Z");
    mockDbUpdateResult([{ id: "sevt_1", readAt }]);

    const event = await markSocialEventRead("ws_1", "sevt_1");

    expect(event.readAt).toEqual(readAt);
  });

  it("throws when an event cannot be marked as read", async () => {
    mockDbUpdateResult([]);

    await expect(markSocialEventRead("ws_1", "sevt_missing")).rejects.toThrow(
      SocialEventNotFoundError,
    );
  });

  it("claims webhook deliveries and records retry metadata", async () => {
    const lockedAt = new Date("2026-03-27T12:00:00.000Z");
    mockDbUpdateResult([
      {
        id: "swhd_1",
        attemptCount: 1,
        lockedAt,
      },
    ]);

    const row = await claimWebhookDelivery({
      deliveryId: "swhd_1",
      now: lockedAt,
    });

    expect(row?.attemptCount).toBe(1);
    expect(row?.lockedAt).toEqual(lockedAt);
  });

  it("moves webhook deliveries into pending retry and failed states", async () => {
    const nextAttemptAt = new Date("2026-03-27T12:05:00.000Z");
    mockDbUpdateResult([
      {
        id: "swhd_1",
        status: "pending",
        nextAttemptAt,
      },
    ]);

    const retry = await markWebhookDeliveryPendingRetry({
      deliveryId: "swhd_1",
      nextAttemptAt,
      responseStatus: 500,
      responseBody: "temporary failure",
      lastError: "Webhook responded with status 500.",
    });

    expect(retry?.status).toBe("pending");

    mockDbUpdateResult([
      {
        id: "swhd_1",
        status: "failed",
      },
    ]);

    const failed = await markWebhookDeliveryFailed({
      deliveryId: "swhd_1",
      responseStatus: 500,
      responseBody: "dead letter",
      lastError: "Webhook responded with status 500.",
    });

    expect(failed?.status).toBe("failed");
  });
});
