import { createHash, createPublicKey, verify } from "node:crypto";
import { z } from "zod";

import { licensedTrendCatalogUnsignedSchema } from "./licensed-trend-types";

const providerKeySchema = z.string().regex(/^[a-z][a-z0-9._-]{1,119}$/);
const keyIdSchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$/);
const publicKeyConfigSchema = z.record(
  providerKeySchema,
  z.record(keyIdSchema, z.string().min(1).max(20_000)),
);

export const licensedTrendProviderEventSchema = z.discriminatedUnion("action", [
  z.object({
    schema: z.literal("licensed-trend-provider-event/v1"),
    action: z.literal("publish_batch"),
    documents: z.array(licensedTrendCatalogUnsignedSchema).min(1).max(20),
  }).strict(),
  z.object({
    schema: z.literal("licensed-trend-provider-event/v1"),
    action: z.literal("set_catalog_state"),
    catalogId: z.string().trim().min(1).max(200),
    state: z.enum(["active", "paused", "revoked"]),
  }).strict(),
]);

export type LicensedTrendProviderEvent = z.infer<typeof licensedTrendProviderEventSchema>;

export type LicensedTrendProviderEventIdentity = {
  providerKey: string;
  eventId: string;
  sequence: number;
  keyId: string;
  occurredAt: Date;
  eventDigest: `sha256:${string}`;
};

export class LicensedTrendProviderRequestError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
  ) {
    super(code);
  }
}

function fail(code: string, status: number): never {
  throw new LicensedTrendProviderRequestError(code, status);
}

export function licensedTrendProviderSigningMessage(input: {
  providerKey: string;
  eventId: string;
  sequence: number;
  occurredAt: string;
  eventDigest: string;
}) {
  return [
    input.providerKey,
    input.eventId,
    String(input.sequence),
    input.occurredAt,
    input.eventDigest,
  ].join("\n");
}

export function readLicensedTrendProviderPublicKeys(raw = process.env.LICENSED_TREND_PROVIDER_PUBLIC_KEYS_JSON) {
  if (!raw?.trim()) fail("LICENSED_TREND_PROVIDER_KEYS_NOT_CONFIGURED", 503);
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    fail("LICENSED_TREND_PROVIDER_KEYS_INVALID", 503);
  }
  const result = publicKeyConfigSchema.safeParse(parsed);
  if (!result.success || Object.keys(result.data).length === 0) {
    fail("LICENSED_TREND_PROVIDER_KEYS_INVALID", 503);
  }
  return result.data;
}

function parsePositiveSequence(raw: string | null) {
  if (!raw || !/^[1-9][0-9]{0,15}$/.test(raw)) {
    fail("LICENSED_TREND_PROVIDER_IDENTITY_INVALID", 400);
  }
  const sequence = Number(raw);
  if (!Number.isSafeInteger(sequence) || sequence <= 0) {
    fail("LICENSED_TREND_PROVIDER_IDENTITY_INVALID", 400);
  }
  return sequence;
}

function parseSignature(raw: string | null) {
  if (!raw || !/^[A-Za-z0-9_-]{86}$/.test(raw)) {
    fail("LICENSED_TREND_PROVIDER_SIGNATURE_INVALID", 401);
  }
  const signature = Buffer.from(raw, "base64url");
  if (signature.byteLength !== 64) {
    fail("LICENSED_TREND_PROVIDER_SIGNATURE_INVALID", 401);
  }
  return signature;
}

export function verifyLicensedTrendProviderRequest(input: {
  providerKey: string;
  body: Uint8Array;
  eventId: string | null;
  sequence: string | null;
  occurredAt: string | null;
  keyId: string | null;
  signature: string | null;
  publicKeysJson?: string;
  at?: Date;
}) {
  const provider = providerKeySchema.safeParse(input.providerKey);
  const eventId = z.string().trim().min(1).max(200).safeParse(input.eventId);
  const keyId = keyIdSchema.safeParse(input.keyId);
  const occurredAtText = z.string().datetime().safeParse(input.occurredAt);
  if (!provider.success || !eventId.success || !keyId.success || !occurredAtText.success) {
    fail("LICENSED_TREND_PROVIDER_IDENTITY_INVALID", 400);
  }
  const sequence = parsePositiveSequence(input.sequence);
  const occurredAt = new Date(occurredAtText.data);
  const at = input.at ?? new Date();
  if (occurredAt.getTime() > at.getTime() + 5 * 60_000) {
    fail("LICENSED_TREND_PROVIDER_OCCURRED_AT_INVALID", 400);
  }
  const keys = readLicensedTrendProviderPublicKeys(input.publicKeysJson);
  const pem = keys[provider.data]?.[keyId.data];
  if (!pem) fail("LICENSED_TREND_PROVIDER_KEY_UNKNOWN", 401);

  let publicKey;
  try {
    publicKey = createPublicKey(pem);
  } catch {
    fail("LICENSED_TREND_PROVIDER_KEYS_INVALID", 503);
  }
  if (publicKey.asymmetricKeyType !== "ed25519") {
    fail("LICENSED_TREND_PROVIDER_KEYS_INVALID", 503);
  }

  const eventDigest = `sha256:${createHash("sha256").update(input.body).digest("hex")}` as const;
  const message = licensedTrendProviderSigningMessage({
    providerKey: provider.data,
    eventId: eventId.data,
    sequence,
    occurredAt: occurredAtText.data,
    eventDigest,
  });
  let signature: Buffer;
  try {
    signature = parseSignature(input.signature);
  } catch (error) {
    throw error;
  }
  if (!verify(null, Buffer.from(message, "utf8"), publicKey, signature)) {
    fail("LICENSED_TREND_PROVIDER_SIGNATURE_INVALID", 401);
  }

  let rawPayload: unknown;
  try {
    rawPayload = JSON.parse(Buffer.from(input.body).toString("utf8"));
  } catch {
    fail("LICENSED_TREND_PROVIDER_PAYLOAD_INVALID", 400);
  }
  const payload = licensedTrendProviderEventSchema.safeParse(rawPayload);
  if (!payload.success) fail("LICENSED_TREND_PROVIDER_PAYLOAD_INVALID", 400);
  if (payload.data.action === "publish_batch" && payload.data.documents.some((document) => document.provider.key !== provider.data)) {
    fail("LICENSED_TREND_PROVIDER_PAYLOAD_PROVIDER_MISMATCH", 400);
  }

  return {
    identity: {
      providerKey: provider.data,
      eventId: eventId.data,
      sequence,
      keyId: keyId.data,
      occurredAt,
      eventDigest,
    } satisfies LicensedTrendProviderEventIdentity,
    payload: payload.data,
  };
}
