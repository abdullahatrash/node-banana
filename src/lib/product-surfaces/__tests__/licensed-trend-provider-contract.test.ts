import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { describe, expect, it } from "vitest";

import {
  LicensedTrendProviderRequestError,
  licensedTrendProviderSigningMessage,
  verifyLicensedTrendProviderRequest,
} from "../licensed-trend-provider-contract";

const { privateKey, publicKey } = generateKeyPairSync("ed25519");
const publicKeyPem = publicKey.export({ format: "pem", type: "spki" }).toString();
const providerKey = "licensed.partner";
const keyId = "partner-2026";
const occurredAt = "2026-09-05T10:00:00.000Z";

function signedRequest(payload: unknown, overrides: Partial<Parameters<typeof verifyLicensedTrendProviderRequest>[0]> = {}) {
  const body = Buffer.from(JSON.stringify(payload));
  const eventDigest = `sha256:${createHash("sha256").update(body).digest("hex")}`;
  const sequence = 1;
  const eventId = "event-1";
  const message = licensedTrendProviderSigningMessage({ providerKey, eventId, sequence, occurredAt, eventDigest });
  return {
    providerKey,
    body,
    eventId,
    sequence: String(sequence),
    occurredAt,
    keyId,
    signature: sign(null, Buffer.from(message), privateKey).toString("base64url"),
    publicKeysJson: JSON.stringify({ [providerKey]: { [keyId]: publicKeyPem } }),
    at: new Date("2026-09-05T10:01:00.000Z"),
    ...overrides,
  };
}

const stateEvent = {
  schema: "licensed-trend-provider-event/v1",
  action: "set_catalog_state",
  catalogId: "catalog-1",
  state: "paused",
} as const;

describe("licensed trend provider request contract", () => {
  it("verifies an Ed25519-signed event and binds its exact body digest", () => {
    const result = verifyLicensedTrendProviderRequest(signedRequest(stateEvent));
    expect(result.identity).toMatchObject({ providerKey, eventId: "event-1", sequence: 1, keyId });
    expect(result.identity.eventDigest).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(result.payload).toEqual(stateEvent);
  });

  it("rejects modified bytes and unknown signing keys", () => {
    const request = signedRequest(stateEvent);
    expect(() => verifyLicensedTrendProviderRequest({ ...request, body: Buffer.from(`${request.body.toString()} `) }))
      .toThrowError(expect.objectContaining({ code: "LICENSED_TREND_PROVIDER_SIGNATURE_INVALID", status: 401 }));
    expect(() => verifyLicensedTrendProviderRequest({ ...request, keyId: "retired-key" }))
      .toThrowError(expect.objectContaining({ code: "LICENSED_TREND_PROVIDER_KEY_UNKNOWN", status: 401 }));
  });

  it("rejects future timestamps, invalid payloads, and unconfigured trust roots", () => {
    expect(() => verifyLicensedTrendProviderRequest({ ...signedRequest(stateEvent), at: new Date("2026-09-05T09:00:00.000Z") }))
      .toThrowError(expect.objectContaining({ code: "LICENSED_TREND_PROVIDER_OCCURRED_AT_INVALID" }));
    expect(() => verifyLicensedTrendProviderRequest(signedRequest({ ...stateEvent, extra: true })))
      .toThrowError(expect.objectContaining({ code: "LICENSED_TREND_PROVIDER_PAYLOAD_INVALID" }));
    expect(() => verifyLicensedTrendProviderRequest({ ...signedRequest(stateEvent), publicKeysJson: "{}" }))
      .toThrowError(LicensedTrendProviderRequestError);
  });
});
