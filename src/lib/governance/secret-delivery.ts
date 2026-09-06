import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

const VERSION = "v1";

function key(): Buffer {
  const material = process.env.GOVERNANCE_SECRET_DELIVERY_KEY?.trim() || process.env.BETTER_AUTH_SECRET?.trim();
  if (!material) {
    if (process.env.NODE_ENV === "production") throw new Error("GOVERNANCE_SECRET_DELIVERY_KEY or BETTER_AUTH_SECRET is required.");
    return createHash("sha256").update("node-banana-local-governance-delivery-key").digest();
  }
  return createHash("sha256").update(`governance-secret-delivery:${material}`).digest();
}

export function encryptGovernanceSecretDelivery(value: unknown): string {
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), nonce);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
  return [VERSION, nonce.toString("base64url"), cipher.getAuthTag().toString("base64url"), ciphertext.toString("base64url")].join(".");
}

export function decryptGovernanceSecretDelivery(envelope: string): unknown {
  const [version, nonce, tag, ciphertext] = envelope.split(".");
  if (version !== VERSION || !nonce || !tag || !ciphertext) throw new Error("Invalid governance secret delivery envelope.");
  const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(nonce, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return JSON.parse(Buffer.concat([decipher.update(Buffer.from(ciphertext, "base64url")), decipher.final()]).toString("utf8")) as unknown;
}
