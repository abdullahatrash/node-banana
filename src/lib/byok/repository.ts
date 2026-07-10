import { randomUUID } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";

import { getDb } from "@/lib/db";
import { workspaceProviderKeys } from "@/lib/db/schema";

import { decryptProviderKey, encryptProviderKey } from "./crypto";
import { maskProviderKey } from "./mask";
import type { ByokProvider } from "./providers";

/**
 * Everything a read path may ever expose about a stored provider key. The
 * raw key itself is deliberately absent from this shape — see
 * `resolveProviderKey` for the one seam that returns plaintext, and note
 * that it is not part of this type.
 */
export interface ProviderKeySummary {
  provider: ByokProvider;
  /** Non-secret display hint, e.g. "sk-…abc4". Never the raw key. */
  hint: string;
  lastValidatedAt: Date | null;
  updatedAt: Date;
}

interface ProviderKeyRow {
  provider: string;
  keyHint: string;
  lastValidatedAt: Date | null;
  updatedAt: Date;
}

function toSummary(row: ProviderKeyRow): ProviderKeySummary {
  return {
    provider: row.provider as ByokProvider,
    hint: row.keyHint,
    lastValidatedAt: row.lastValidatedAt,
    updatedAt: row.updatedAt,
  };
}

/**
 * List a workspace's stored provider keys (masked hints only, newest first).
 * Callers should validate the key with `validateProviderKey` (see
 * `./validation`) *before* calling `upsertProviderKey` — this repository
 * does not re-validate, it only persists.
 */
export async function listProviderKeys(
  workspaceId: string,
): Promise<ProviderKeySummary[]> {
  const db = getDb();

  const rows = await db
    .select({
      provider: workspaceProviderKeys.provider,
      keyHint: workspaceProviderKeys.keyHint,
      lastValidatedAt: workspaceProviderKeys.lastValidatedAt,
      updatedAt: workspaceProviderKeys.updatedAt,
    })
    .from(workspaceProviderKeys)
    .where(eq(workspaceProviderKeys.workspaceId, workspaceId))
    .orderBy(desc(workspaceProviderKeys.updatedAt));

  return rows.map(toSummary);
}

/**
 * Create or rotate the stored key for a (workspace, provider) pair. Encrypts
 * at rest and stores a masked hint; the raw key is never persisted or
 * returned. Upserts on the `(workspace_id, provider)` unique constraint, so
 * saving again for the same provider rotates the key in place.
 */
export async function upsertProviderKey(input: {
  workspaceId: string;
  provider: ByokProvider;
  rawKey: string;
  createdByUserId: string;
}): Promise<ProviderKeySummary> {
  const db = getDb();
  const now = new Date();
  const keyEncrypted = encryptProviderKey(input.rawKey);
  const keyHint = maskProviderKey(input.rawKey);

  const [row] = await db
    .insert(workspaceProviderKeys)
    .values({
      id: `provkey_${randomUUID()}`,
      workspaceId: input.workspaceId,
      provider: input.provider,
      keyEncrypted,
      keyHint,
      lastValidatedAt: now,
      createdByUserId: input.createdByUserId,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [workspaceProviderKeys.workspaceId, workspaceProviderKeys.provider],
      set: {
        keyEncrypted,
        keyHint,
        lastValidatedAt: now,
        updatedAt: now,
      },
    })
    .returning({
      provider: workspaceProviderKeys.provider,
      keyHint: workspaceProviderKeys.keyHint,
      lastValidatedAt: workspaceProviderKeys.lastValidatedAt,
      updatedAt: workspaceProviderKeys.updatedAt,
    });

  return toSummary(row);
}

/**
 * Delete a workspace's stored key for a provider. Returns true when a row
 * was actually removed, false when there was nothing to delete.
 */
export async function deleteProviderKey(input: {
  workspaceId: string;
  provider: ByokProvider;
}): Promise<boolean> {
  const db = getDb();

  const rows = await db
    .delete(workspaceProviderKeys)
    .where(
      and(
        eq(workspaceProviderKeys.workspaceId, input.workspaceId),
        eq(workspaceProviderKeys.provider, input.provider),
      ),
    )
    .returning({ id: workspaceProviderKeys.id });

  return rows.length > 0;
}

/**
 * Resolve the raw (decrypted) provider key for a workspace.
 *
 * This is the seam later slices (#108 generate route, #109 LLM route) call
 * as the vault tier of the key-resolution order:
 *
 *   1. Request header override (e.g. `X-OpenAI-API-Key`) — ad-hoc / agent use
 *   2. `resolveProviderKey(workspaceId, provider)` — this workspace vault
 *   3. A typed "no key configured for <provider>" error surfaced to the user
 *
 * Contract:
 *  - Returns `null` — never throws — when the workspace has no stored key
 *    for the provider. Treat `null` as "fall through to the next tier", not
 *    as an error condition.
 *  - Returns the plaintext key, ready to use directly in a request header or
 *    SDK client. Callers must never log or persist it.
 *  - Throws only for genuine misconfiguration (e.g.
 *    `BYOK_KEY_ENCRYPTION_KEY` unset outside dev bypass, or corrupted
 *    ciphertext) — these are ops problems, not per-request conditions, and
 *    should surface as 500s rather than "no key configured".
 */
export async function resolveProviderKey(
  workspaceId: string,
  provider: ByokProvider,
): Promise<string | null> {
  const db = getDb();

  const [row] = await db
    .select({ keyEncrypted: workspaceProviderKeys.keyEncrypted })
    .from(workspaceProviderKeys)
    .where(
      and(
        eq(workspaceProviderKeys.workspaceId, workspaceId),
        eq(workspaceProviderKeys.provider, provider),
      ),
    )
    .limit(1);

  if (!row) return null;
  return decryptProviderKey(row.keyEncrypted);
}
