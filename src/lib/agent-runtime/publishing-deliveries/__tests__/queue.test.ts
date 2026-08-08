import { beforeEach, describe, expect, it, vi } from "vitest";

const start = vi.fn();

vi.mock("workflow/api", () => ({ start }));

describe("DurablePublishingDeliveryQueue", () => {
  beforeEach(() => start.mockReset());

  it("starts a durable worker only for the exact Delivery generation", async () => {
    const { DurablePublishingDeliveryQueue } = await import("../queue");
    const queue = new DurablePublishingDeliveryQueue();
    await queue.schedule({
      workspaceId: "workspace_1",
      deliveryId: "delivery_1",
      dedupeKey: "publishing-delivery:workspace_1:delivery_1:v3",
    });
    expect(start).toHaveBeenCalledTimes(1);
    expect(start.mock.calls[0]?.[1]).toEqual([
      { workspaceId: "workspace_1", deliveryId: "delivery_1" },
    ]);
  });

  it("rejects a retargeted or malformed durable dispatch identity", async () => {
    const { DurablePublishingDeliveryQueue } = await import("../queue");
    const queue = new DurablePublishingDeliveryQueue();
    await expect(
      queue.schedule({
        workspaceId: "workspace_1",
        deliveryId: "delivery_1",
        dedupeKey: "publishing-delivery:workspace_1:delivery_other:v1",
      }),
    ).rejects.toThrow("dispatch identity is invalid");
    await expect(
      queue.schedule({
        workspaceId: "workspace_1",
        deliveryId: "delivery_1",
        dedupeKey: "publishing-delivery:workspace_1:delivery_1:v0",
      }),
    ).rejects.toThrow("dispatch identity is invalid");
    expect(start).not.toHaveBeenCalled();
  });
});
