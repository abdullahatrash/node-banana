import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { isDevAuthBypassEnabled } from "@/lib/auth/session";
import { logger } from "@/utils/logger";

/**
 * AES-256-GCM at-rest encryption for workspace BYOK provider keys.
 *
 * Deliberately mirrors `src/lib/social/crypto.ts` (same algorithm, format,
 * and dev-bypass plaintext fallback) but uses its own env var so rotating
 * the social-token key never invalidates provider keys or vice versa.
 */

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;
const PLAINTEXT_PREFIX = "plain:";

function getEncryptionKey(): Buffer | null {
  const hex = process.env.BYOK_KEY_ENCRYPTION_KEY?.trim();
  if (!hex) return null;
  const buf = Buffer.from(hex, "hex");
  if (buf.length !== 32) {
    throw new Error(
      "BYOK_KEY_ENCRYPTION_KEY must be a 64-character hex string (32 bytes).",
    );
  }
  return buf;
}

/**
 * Encrypt a plaintext provider API key for storage at rest.
 * Format: base64(iv):base64(authTag):base64(ciphertext)
 *
 * In dev bypass mode without an encryption key, stores plaintext with a prefix.
 */
export function encryptProviderKey(plaintext: string): string {
  const key = getEncryptionKey();
  if (!key) {
    if (isDevAuthBypassEnabled()) {
      logger.warn(
        "system",
        "BYOK_KEY_ENCRYPTION_KEY not set — storing provider key in plaintext (dev bypass)",
      );
      return `${PLAINTEXT_PREFIX}${plaintext}`;
    }
    throw new Error(
      "BYOK_KEY_ENCRYPTION_KEY is required for provider key encryption.",
    );
  }

  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();

  return `${iv.toString("base64")}:${authTag.toString("base64")}:${encrypted.toString("base64")}`;
}

/**
 * Decrypt a provider key stored at rest.
 */
export function decryptProviderKey(encrypted: string): string {
  if (encrypted.startsWith(PLAINTEXT_PREFIX)) {
    return encrypted.slice(PLAINTEXT_PREFIX.length);
  }

  const key = getEncryptionKey();
  if (!key) {
    throw new Error(
      "BYOK_KEY_ENCRYPTION_KEY is required for provider key decryption.",
    );
  }

  const parts = encrypted.split(":");
  if (parts.length !== 3) {
    throw new Error("Invalid encrypted provider key format.");
  }

  const iv = Buffer.from(parts[0], "base64");
  const authTag = Buffer.from(parts[1], "base64");
  const ciphertext = Buffer.from(parts[2], "base64");

  if (iv.length !== IV_LENGTH || authTag.length !== AUTH_TAG_LENGTH) {
    throw new Error("Invalid encrypted provider key format.");
  }

  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  const decrypted = Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]);

  return decrypted.toString("utf8");
}

/**
 * Check if provider key encryption is configured.
 */
export function isProviderKeyEncryptionConfigured(): boolean {
  return getEncryptionKey() !== null;
}
