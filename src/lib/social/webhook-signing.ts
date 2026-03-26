import { createHmac } from "node:crypto";

export function createWebhookSignature(
  signingSecret: string,
  payload: string,
  timestamp: string,
): string {
  const signedPayload = `${timestamp}.${payload}`;
  return createHmac("sha256", signingSecret).update(signedPayload).digest("hex");
}
