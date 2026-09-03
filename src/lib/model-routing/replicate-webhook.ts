import { createHmac, timingSafeEqual } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { canonicalDigest } from "@/lib/agent-tools/canonical";
import type { getDb } from "@/lib/db";
import { modelProviderEffectClaims, modelProviderWebhookReceipts, replicatePredictionIdentities } from "./db-schema";

type Db = ReturnType<typeof getDb>;
const MAX_SKEW_SECONDS = 5 * 60;

export function verifyReplicateWebhook(input: { body: string; eventId: string | null; timestamp: string | null; signature: string | null; secret: string | undefined; at: Date }): { ok: true; eventId: string } | { ok: false; code: string } {
  if (!input.secret || input.secret.length < 32 || !input.eventId || input.eventId.length < 8 || !input.timestamp || !/^\d{10}$/.test(input.timestamp) || !input.signature) return { ok: false, code: "WEBHOOK_AUTH_REQUIRED" };
  const seconds = Number(input.timestamp); if (!Number.isSafeInteger(seconds) || Math.abs(Math.floor(input.at.getTime() / 1000) - seconds) > MAX_SKEW_SECONDS) return { ok: false, code: "WEBHOOK_TIMESTAMP_INVALID" };
  const encodedSecret = input.secret.startsWith("whsec_") ? input.secret.slice(6) : input.secret;
  let secret: Buffer; try { secret = Buffer.from(encodedSecret, "base64"); } catch { return { ok: false, code: "WEBHOOK_SECRET_INVALID" }; }
  if (secret.byteLength < 24) return { ok: false, code: "WEBHOOK_SECRET_INVALID" };
  const expected = createHmac("sha256", secret).update(`${input.eventId}.${input.timestamp}.${input.body}`).digest();
  const candidates = input.signature.split(" ").map((item) => item.startsWith("v1,") ? item.slice(3) : "").filter(Boolean);
  const valid = candidates.some((candidate) => { try { const value = Buffer.from(candidate, "base64"); return value.byteLength === expected.byteLength && timingSafeEqual(value, expected); } catch { return false; } });
  return valid ? { ok: true, eventId: input.eventId } : { ok: false, code: "WEBHOOK_SIGNATURE_INVALID" };
}

/** Authenticated terminal webhooks only wake the durable poller; provider output is still fetched with the pinned credential. */
export async function recordReplicateCompletionWebhook(input: { database: Db; eventId: string; predictionId: string; providerStatus: "succeeded" | "failed" | "canceled"; providerVersion: string | null; payload: unknown; at: Date }) {
  return input.database.transaction(async (tx) => {
    const [identity] = await tx.select().from(replicatePredictionIdentities).where(eq(replicatePredictionIdentities.predictionId, input.predictionId)).limit(1);
    if (!identity) return { kind: "not_found" as const };
    if (input.providerVersion && input.providerVersion !== identity.model.version) return { kind: "version_mismatch" as const };
    const payloadDigest = canonicalDigest(input.payload);
    const [existing] = await tx.select().from(modelProviderWebhookReceipts).where(and(eq(modelProviderWebhookReceipts.provider, "replicate"), eq(modelProviderWebhookReceipts.eventId, input.eventId))).for("update");
    if (existing) return existing.payloadDigest === payloadDigest && existing.predictionId === input.predictionId ? { kind: "replayed" as const } : { kind: "conflict" as const };
    await tx.insert(modelProviderWebhookReceipts).values({ workspaceId: identity.workspaceId, provider: "replicate", eventId: input.eventId, predictionId: input.predictionId, payloadDigest, status: "processed", receivedAt: input.at, processedAt: input.at });
    await tx.update(modelProviderEffectClaims).set({ providerStatus: `webhook_${input.providerStatus}`, nextPollAt: input.at, leaseOwner: null, leaseExpiresAt: null, updatedAt: input.at }).where(and(eq(modelProviderEffectClaims.workspaceId, identity.workspaceId), eq(modelProviderEffectClaims.intentId, identity.intentId), eq(modelProviderEffectClaims.predictionId, input.predictionId)));
    return { kind: "accepted" as const, workspaceId: identity.workspaceId, intentId: identity.intentId };
  });
}
