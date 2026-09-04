import { createHmac, randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { matchesReplicatePredictionIdentity, verifyReplicateWebhook } from "../replicate-webhook";

const at = new Date("2026-09-03T00:00:00.000Z");
const secretBytes = randomBytes(32); const secret = `whsec_${secretBytes.toString("base64")}`;
const eventId = "webhook-event-123"; const timestamp = String(Math.floor(at.getTime() / 1000)); const body = JSON.stringify({ id: "prediction", status: "succeeded" });
const signature = `v1,${createHmac("sha256", secretBytes).update(`${eventId}.${timestamp}.${body}`).digest("base64")}`;

describe("Replicate webhook authentication", () => {
  it("accepts an authentic recent signed payload", () => {
    expect(verifyReplicateWebhook({ body, eventId, timestamp, signature, secret, at })).toEqual({ ok: true, eventId });
  });
  it("rejects tampering, stale delivery, and missing trust roots", () => {
    expect(verifyReplicateWebhook({ body: `${body} `, eventId, timestamp, signature, secret, at })).toMatchObject({ ok: false, code: "WEBHOOK_SIGNATURE_INVALID" });
    expect(verifyReplicateWebhook({ body, eventId, timestamp, signature, secret, at: new Date(at.getTime() + 301_000) })).toMatchObject({ ok: false, code: "WEBHOOK_TIMESTAMP_INVALID" });
    expect(verifyReplicateWebhook({ body, eventId, timestamp, signature, secret: undefined, at })).toMatchObject({ ok: false, code: "WEBHOOK_AUTH_REQUIRED" });
  });
});

describe("Replicate webhook prediction identity", () => {
  const official = { provider: "replicate" as const, model: "google/veo-3.1-lite", version: "google/veo-3.1-lite", inputSchemaDigest: `sha256:${"a".repeat(64)}` };
  const versioned = { ...official, model: "owner/community-model", version: "immutable-version-123" };

  it("accepts an Official Model whose provider version is hidden", () => {
    expect(matchesReplicatePredictionIdentity({ storedModel: official, executedVersion: official.model, providerModel: official.model, providerVersion: "hidden" })).toBe(true);
  });

  it("rejects the wrong Official Model and wrong community version", () => {
    expect(matchesReplicatePredictionIdentity({ storedModel: official, executedVersion: official.model, providerModel: "google/veo-3.1", providerVersion: "hidden" })).toBe(false);
    expect(matchesReplicatePredictionIdentity({ storedModel: versioned, executedVersion: versioned.version, providerModel: versioned.model, providerVersion: "different-version" })).toBe(false);
  });
});
