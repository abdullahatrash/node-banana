import { createHash } from "node:crypto";

export function publishingDeliveryWorkerId(stepId: string): string {
  if (!stepId) {
    throw new TypeError("Publishing Delivery step identity is unavailable.");
  }
  return `publishing_worker_${createHash("sha256")
    .update(stepId, "utf8")
    .digest("hex")}`;
}
