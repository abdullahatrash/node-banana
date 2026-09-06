import { randomUUID } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";

import { getDb } from "@/lib/db";
import { apiTokens } from "@/lib/db/schema";

import { generateApiToken, hashApiToken } from "./tokens";

export interface CreatedApiToken {
  id: string;
  name: string;
  /** Raw secret — returned exactly once, never persisted. */
  token: string;
  prefix: string;
  createdAt: Date;
}

export interface ApiTokenSummary {
  id: string;
  name: string;
  prefix: string;
  revoked: boolean;
  lastUsedAt: Date | null;
  createdAt: Date;
}

/**
 * Mint and persist a new workspace-scoped API token. Only the SHA-256 hash and
 * a non-secret display prefix are stored; the raw token is returned to the
 * caller once.
 */
export async function createApiToken(input: {
  workspaceId: string;
  name: string;
  createdByUserId: string;
}): Promise<CreatedApiToken> {
  const db = getDb();
  const generated = generateApiToken();
  const id = `apitok_${randomUUID()}`;

  const [row] = await db
    .insert(apiTokens)
    .values({
      id,
      workspaceId: input.workspaceId,
      name: input.name,
      tokenHash: generated.hash,
      tokenPrefix: generated.prefix,
      createdByUserId: input.createdByUserId,
    })
    .returning();

  return {
    id: row.id,
    name: row.name,
    token: generated.raw,
    prefix: row.tokenPrefix,
    createdAt: row.createdAt,
  };
}

/**
 * List a workspace's tokens (newest first). Never returns the hash.
 */
export async function listApiTokens(
  workspaceId: string,
): Promise<ApiTokenSummary[]> {
  const db = getDb();

  const rows = await db
    .select({
      id: apiTokens.id,
      name: apiTokens.name,
      prefix: apiTokens.tokenPrefix,
      revoked: apiTokens.revoked,
      lastUsedAt: apiTokens.lastUsedAt,
      createdAt: apiTokens.createdAt,
    })
    .from(apiTokens)
    .where(eq(apiTokens.workspaceId, workspaceId))
    .orderBy(desc(apiTokens.createdAt));

  return rows;
}

/**
 * Revoke a token within a workspace. Scoped by workspaceId so a token in
 * another tenant can never be revoked through this call. Returns true when a
 * matching, not-already-revoked token was updated.
 */
export async function revokeApiToken(input: {
  workspaceId: string;
  tokenId: string;
}): Promise<boolean> {
  const db = getDb();

  const rows = await db
    .update(apiTokens)
    .set({ revoked: true, revokedAt: new Date(), updatedAt: new Date() })
    .where(
      and(
        eq(apiTokens.id, input.tokenId),
        eq(apiTokens.workspaceId, input.workspaceId),
        eq(apiTokens.revoked, false),
      ),
    )
    .returning({ id: apiTokens.id });

  return rows.length > 0;
}

/**
 * Resolve a raw Bearer token to the workspace it can reach. Matches by hash,
 * ignores revoked tokens, and records last-used. Returns null for unknown or
 * revoked tokens so callers can respond with 401.
 */
export async function resolveWorkspaceIdByRawToken(
  rawToken: string,
): Promise<string | null> {
  return (await resolveApiTokenAuthorityByRawToken(rawToken))?.workspaceId ?? null;
}

export async function resolveApiTokenAuthorityByRawToken(
  rawToken: string,
): Promise<{ workspaceId: string; createdByUserId: string } | null> {
  const db = getDb();
  const hash = hashApiToken(rawToken);

  const [row] = await db
    .select({ id: apiTokens.id, workspaceId: apiTokens.workspaceId, createdByUserId: apiTokens.createdByUserId })
    .from(apiTokens)
    .where(and(eq(apiTokens.tokenHash, hash), eq(apiTokens.revoked, false)))
    .limit(1);

  if (!row) return null;

  await db
    .update(apiTokens)
    .set({ lastUsedAt: new Date() })
    .where(eq(apiTokens.id, row.id));

  return { workspaceId: row.workspaceId, createdByUserId: row.createdByUserId };
}
