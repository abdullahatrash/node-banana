import { describe, expect, it } from "vitest";
import { BrandSourceReadError } from "../ports";
import {
  assertPublicUrl,
  isPublicAddress,
  normalizeWebsiteUrl,
} from "../url-policy";

describe("Brand Source URL policy", () => {
  it("accepts ordinary public IPv4 and IPv6 addresses", () => {
    expect(isPublicAddress("8.8.8.8")).toBe(true);
    expect(isPublicAddress("2606:4700:4700::1111")).toBe(true);
  });

  it("blocks private, loopback, link-local, documentation, and mapped addresses", () => {
    for (const address of [
      "0.0.0.0",
      "10.1.2.3",
      "100.64.1.1",
      "127.0.0.1",
      "169.254.169.254",
      "172.20.0.1",
      "192.168.1.1",
      "198.51.100.2",
      "::1",
      "fc00::1",
      "fe80::1",
      "2001:db8::1",
      "::ffff:127.0.0.1",
    ]) {
      expect(isPublicAddress(address), address).toBe(false);
    }
  });

  it("normalizes safe URLs and rejects credentials and unusual ports", () => {
    expect(normalizeWebsiteUrl("HTTPS://Example.COM/path#section").toString()).toBe(
      "https://example.com/path",
    );
    expect(() => normalizeWebsiteUrl("https://user:pass@example.com")).toThrow(
      BrandSourceReadError,
    );
    expect(() => normalizeWebsiteUrl("https://example.com:8443")).toThrow(
      /standard website ports/,
    );
    expect(() => normalizeWebsiteUrl("file:///etc/passwd")).toThrow(/Only public/);
  });

  it("blocks a hostname when any answer is private to prevent rebinding", async () => {
    await expect(
      assertPublicUrl(new URL("https://example.com"), {
        resolve: async () => [
          { address: "8.8.8.8", family: 4 },
          { address: "127.0.0.1", family: 4 },
        ],
      }),
    ).rejects.toMatchObject({ code: "SOURCE_BLOCKED", retryable: false });
  });
});

