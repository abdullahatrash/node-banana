import { describe, expect, it, vi } from "vitest";
import { deliverGovernanceSecret, redactGovernanceSecrets } from "../notifications";

describe("governance notifications", () => {
  it("delivers bilingual RTL/LTR secure-action mail without exposing secrets in API results", async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    await deliverGovernanceSecret({ sender: { send }, recipient: "reviewer@example.com", kind: "review", actionUrl: "https://app.example/review/opaque", code: "123456" });
    expect(send).toHaveBeenCalledWith(expect.objectContaining({
      to: "reviewer@example.com",
      subject: expect.stringContaining("Secure review requested"),
      html: expect.stringMatching(/lang="ar" dir="rtl"[\s\S]*lang="en" dir="ltr"/),
      text: expect.stringContaining("123456"),
    }));
    expect(redactGovernanceSecrets({ grantId: "grant-1", reviewToken: "secret", verificationCode: "123456" })).toEqual({ grantId: "grant-1" });
  });
});
