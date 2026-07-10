import { createHash, randomBytes } from "node:crypto";

/**
 * Recognizable, non-secret prefix on every raw API token. Lets humans and
 * tooling spot a Node Banana token at a glance (mirrors `ghp_`, `sk-`, ...).
 */
export const API_TOKEN_PREFIX = "nb_";

/**
 * Number of characters (including the prefix) retained as a non-secret display
 * hint. Enough to disambiguate tokens in a list without revealing the secret.
 */
const DISPLAY_PREFIX_LENGTH = 11;

/** Random secret bytes appended after the prefix. 32 bytes = 256 bits. */
const SECRET_BYTES = 32;

export interface GeneratedApiToken {
  /** Full secret, shown to the user exactly once. */
  raw: string;
  /** SHA-256 hex digest of the raw token — the only value persisted. */
  hash: string;
  /** Non-secret leading slice, safe to store and display for identification. */
  prefix: string;
}

/**
 * SHA-256 hex digest of a raw token. Deterministic so a presented Bearer token
 * can be matched against the stored hash without ever persisting the secret.
 */
export function hashApiToken(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

/**
 * Mint a new API token. Returns the raw secret (shown once), its hash (stored),
 * and a short non-secret display prefix.
 */
export function generateApiToken(): GeneratedApiToken {
  const secret = randomBytes(SECRET_BYTES).toString("base64url");
  const raw = `${API_TOKEN_PREFIX}${secret}`;

  return {
    raw,
    hash: hashApiToken(raw),
    prefix: raw.slice(0, DISPLAY_PREFIX_LENGTH),
  };
}
