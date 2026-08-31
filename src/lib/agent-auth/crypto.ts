import {
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

export type AgentCredentialKind = "key" | "challenge";

function kindPrefix(kind: AgentCredentialKind): string {
  return kind === "key" ? "nbak" : "nbpc";
}

export function createOpaqueCredential(kind: AgentCredentialKind): {
  plaintext: string;
  lookupPrefix: string;
  secret: string;
} {
  const lookupPrefix = randomBytes(9).toString("base64url");
  const secret = randomBytes(32).toString("base64url");
  return {
    plaintext: `${kindPrefix(kind)}_${lookupPrefix}_${secret}`,
    lookupPrefix,
    secret,
  };
}

export function deriveOpaqueCredential(
  kind: AgentCredentialKind,
  material: string,
  pepper: string,
): {
  plaintext: string;
  lookupPrefix: string;
  secret: string;
} {
  const derive = (domain: string) =>
    createHmac("sha256", pepper)
      .update(`node-banana:${kind}:${domain}:${material}`, "utf8")
      .digest();
  const lookupPrefix = derive("lookup").subarray(0, 9).toString("base64url");
  const secret = derive("secret").toString("base64url");
  return {
    plaintext: `${kindPrefix(kind)}_${lookupPrefix}_${secret}`,
    lookupPrefix,
    secret,
  };
}

export function parseOpaqueCredential(
  plaintext: string,
  kind: AgentCredentialKind,
): { lookupPrefix: string; secret: string } | null {
  const match = /^(nbak|nbpc)_([A-Za-z0-9_-]{12})_([A-Za-z0-9_-]{43})$/.exec(
    plaintext.trim(),
  );
  if (!match || match[1] !== kindPrefix(kind)) return null;
  return { lookupPrefix: match[2], secret: match[3] };
}

export function hashCredentialSecret(secret: string, pepper: string): string {
  return createHmac("sha256", pepper).update(secret, "utf8").digest("base64url");
}

export function verifyCredentialSecret(
  secret: string,
  expectedHash: string,
  pepper: string,
): boolean {
  try {
    const expected = Buffer.from(expectedHash, "base64url");
    const actual = Buffer.from(
      hashCredentialSecret(secret, pepper),
      "base64url",
    );
    if (actual.length !== expected.length || expected.length !== 32) return false;
    return timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}
