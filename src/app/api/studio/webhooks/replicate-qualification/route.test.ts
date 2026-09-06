import { createHmac } from "node:crypto";
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ record: vi.fn() }));
vi.mock("@/lib/db", () => ({ isDatabaseConfigured: () => true, getDb: () => ({ mocked: true }) }));
vi.mock("@/lib/model-routing/qualification-webhook", () => ({ recordQualificationWebhook: (...args: unknown[]) => mocks.record(...args) }));

const secretBytes = Buffer.from("qualification-webhook-secret-material");
const secret = `whsec_${secretBytes.toString("base64")}`;

function signedRequest(body: string, query = "caseId=arabic-complete&submissionKey=qualification%3Arun-12345678%3Aarabic-complete") {
  const eventId = "evt_qualification_123";
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = createHmac("sha256", secretBytes).update(`${eventId}.${timestamp}.${body}`).digest("base64");
  return new NextRequest(`http://localhost/api/studio/webhooks/replicate-qualification?${query}`, { method: "POST", headers: { "webhook-id": eventId, "webhook-timestamp": timestamp, "webhook-signature": `v1,${signature}` }, body });
}

describe("Replicate qualification webhook route", () => {
  beforeEach(() => {
    vi.stubEnv("REPLICATE_WEBHOOK_SIGNING_SECRET", secret);
    mocks.record.mockReset().mockResolvedValue({ kind: "accepted", runId: "run-12345678" });
  });

  it("verifies and records a correlation-bound start webhook", async () => {
    const body = JSON.stringify({ id: "prediction-1", status: "starting", model: "prunaai/p-video", version: "hidden" });
    const { POST } = await import("./route");
    const response = await POST(signedRequest(body));
    expect(response.status).toBe(202);
    expect(mocks.record).toHaveBeenCalledWith(expect.objectContaining({ caseId: "arabic-complete", submissionKey: "qualification:run-12345678:arabic-complete", predictionId: "prediction-1", providerStatus: "starting", providerModel: "prunaai/p-video" }));
  });

  it("rejects an invalid signature before recording", async () => {
    const request = signedRequest(JSON.stringify({ id: "prediction-1", status: "succeeded", model: "prunaai/p-video" }));
    request.headers.set("webhook-signature", "v1,invalid");
    const { POST } = await import("./route");
    const response = await POST(request);
    expect(response.status).toBe(401);
    expect(mocks.record).not.toHaveBeenCalled();
  });

  it("rejects missing durable correlation before reading the payload", async () => {
    const { POST } = await import("./route");
    const response = await POST(signedRequest("not json", "caseId=x"));
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: "QUALIFICATION_CORRELATION_INVALID" });
  });
});
