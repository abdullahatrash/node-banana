import { isIP } from "node:net";

const SHARED_FALLBACK = "shared-unattributed-client";

function firstValidIp(value: string | null): string | null {
  if (!value) return null;
  for (const candidate of value.split(",")) {
    const normalized = candidate.trim();
    if (isIP(normalized)) return normalized;
  }
  return null;
}

/**
 * Returns an ephemeral rate-limit key, never a persistence value. Only
 * vendor-authenticated proxy headers are trusted by default; generic proxy
 * headers require an explicit deployment opt-in. Unknown clients share one
 * conservative bucket instead of receiving an easy bypass.
 */
export function getPairingClientRateLimitKey(headers: Headers): string {
  const trustedCandidates: Array<string | null> = [];
  const configuredProxy = process.env.PAIRING_TRUSTED_PROXY
    ?.trim()
    .toLowerCase();
  const trustCloudflare =
    configuredProxy === "cloudflare" || process.env.CF_PAGES === "1";
  const trustVercel =
    configuredProxy === "vercel" ||
    process.env.VERCEL === "1" ||
    Boolean(process.env.VERCEL_ENV);
  const trustFly =
    configuredProxy === "fly" || Boolean(process.env.FLY_APP_NAME);
  const trustGeneric =
    configuredProxy === "generic" ||
    process.env.TRUST_PROXY_HEADERS === "true";

  if (trustCloudflare) {
    trustedCandidates.push(headers.get("cf-connecting-ip"));
  }
  if (trustVercel) {
    trustedCandidates.push(
      headers.get("x-vercel-forwarded-for"),
      headers.get("x-forwarded-for"),
    );
  }
  if (trustFly) {
    trustedCandidates.push(headers.get("fly-client-ip"));
  }
  if (trustGeneric) {
    trustedCandidates.push(
      headers.get("x-real-ip"),
      headers.get("x-forwarded-for"),
    );
  }

  for (const value of trustedCandidates) {
    const ip = firstValidIp(value);
    if (ip) return `ip:${ip}`;
  }
  return SHARED_FALLBACK;
}
