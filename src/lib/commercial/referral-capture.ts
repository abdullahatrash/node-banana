import "server-only";
import { createHash, randomBytes } from "node:crypto";

export const REFERRAL_CAPTURE_COOKIE = "node-banana-referral-capture";
export const REFERRAL_CAPTURE_TTL_SECONDS = 30 * 24 * 60 * 60;

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export function createReferralCaptureToken(): string {
  return randomBytes(32).toString("base64url");
}

export function isReferralCaptureToken(value: string): boolean {
  return TOKEN_PATTERN.test(value);
}

export function referralCaptureTokenDigest(value: string): string {
  return `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;
}

export function referralCaptureCookieOptions() {
  return {
    httpOnly: true,
    maxAge: REFERRAL_CAPTURE_TTL_SECONDS,
    path: "/",
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
  };
}
