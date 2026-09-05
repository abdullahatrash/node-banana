import { describe, expect, it } from "vitest";
import {
  createReferralCaptureToken,
  isReferralCaptureToken,
  referralCaptureTokenDigest,
} from "../referral-capture";

describe("referral capture tokens", () => {
  it("creates opaque high-entropy values while persisting only stable digests", () => {
    const first = createReferralCaptureToken();
    const second = createReferralCaptureToken();
    expect(isReferralCaptureToken(first)).toBe(true);
    expect(first).not.toBe(second);
    expect(referralCaptureTokenDigest(first)).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(referralCaptureTokenDigest(first)).toBe(referralCaptureTokenDigest(first));
    expect(referralCaptureTokenDigest(first)).not.toContain(first);
  });

  it("rejects malformed and low-entropy cookie values", () => {
    expect(isReferralCaptureToken("short")).toBe(false);
    expect(isReferralCaptureToken("a".repeat(42))).toBe(false);
    expect(isReferralCaptureToken(`${"a".repeat(42)}!`)).toBe(false);
  });
});
