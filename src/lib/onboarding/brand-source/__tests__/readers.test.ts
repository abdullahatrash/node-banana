import { describe, expect, it, vi } from "vitest";
import type { BrandSourceRecord } from "../../repository";
import { DescriptionBrandSourceReader } from "../description-adapter";
import { BrandSourceReadError } from "../ports";
import { createPinnedLookup, WebsiteBrandSourceReader } from "../website-adapter";

const now = new Date("2026-08-31T12:00:00.000Z");
const publicDns = {
  resolve: async () => [{ address: "8.8.8.8", family: 4 }],
};

function source(overrides: Partial<BrandSourceRecord> = {}): BrandSourceRecord {
  return {
    id: "source_1",
    workspaceId: "ws_1",
    revision: 1,
    kind: "website",
    submittedUrl: "https://example.com",
    finalUrl: null,
    submittedDescription: null,
    cleanedText: null,
    contentHash: null,
    sourceLanguage: null,
    extractedBytes: null,
    fetchedAt: null,
    createdByUserId: "user_1",
    createdAt: now,
    ...overrides,
  };
}

describe("Brand Source readers", () => {
  it("pins transport DNS to the addresses already validated by policy", async () => {
    const lookup = createPinnedLookup([
      { address: "8.8.8.8", family: 4 },
      { address: "2606:4700:4700::1111", family: 6 },
    ]);
    const result = await new Promise<{ address: string; family?: number }>(
      (resolve, reject) => {
        lookup("attacker-controlled.example", { all: false }, (error, address, family) => {
          if (error) reject(error);
          else resolve({ address: String(address), family });
        });
      },
    );
    expect(result).toEqual({ address: "8.8.8.8", family: 4 });
  });

  it("normalizes and hashes a manual description", async () => {
    const reader = new DescriptionBrandSourceReader(() => now);
    const result = await reader.read(
      source({
        kind: "description",
        submittedUrl: null,
        submittedDescription: "  نساعد العلامات التجارية   على إنشاء محتوى عربي موثوق.  ",
      }),
    );
    expect(result.cleanedText).toBe(
      "نساعد العلامات التجارية على إنشاء محتوى عربي موثوق.",
    );
    expect(result.sourceLanguage).toBe("ar");
    expect(result.contentHash).toMatch(/^sha256:[a-f0-9]{64}$/);
  });

  it("reads the homepage and bounded same-origin high-signal pages", async () => {
    const fetchImplementation = vi.fn(async (input: URL | RequestInfo) => {
      const url = String(input);
      if (url.endsWith("/robots.txt")) {
        return new Response("User-agent: *\nAllow: /", {
          headers: { "content-type": "text/plain" },
        });
      }
      if (url.endsWith("/about")) {
        return new Response(
          `<html lang="en"><main><h1>About us</h1><p>We serve MENA marketing teams.</p></main></html>`,
          { headers: { "content-type": "text/html" } },
        );
      }
      return new Response(
        `<html lang="en"><head><title>Tasmeem</title></head><main><h1>Reliable content</h1><p>Arabic-first, multilingual by design.</p><a href="/about">About</a><a href="https://other.example/pricing">Other</a></main></html>`,
        { headers: { "content-type": "text/html" } },
      );
    });
    const reader = new WebsiteBrandSourceReader(
      publicDns,
      fetchImplementation as typeof fetch,
      () => now,
    );
    const result = await reader.read(source());
    expect(result.pages).toHaveLength(2);
    expect(result.cleanedText).toContain("Reliable content");
    expect(result.cleanedText).toContain("We serve MENA marketing teams");
    expect(result.sourceLanguage).toBe("en");
    expect(result.extractedBytes).toBeLessThanOrEqual(6 * 1024 * 1024);
  });

  it("revalidates a redirect and blocks it before a private fetch", async () => {
    const fetchImplementation = vi.fn(async () =>
      new Response(null, {
        status: 302,
        headers: { location: "http://127.0.0.1/admin" },
      }),
    );
    const reader = new WebsiteBrandSourceReader(
      publicDns,
      fetchImplementation as typeof fetch,
      () => now,
    );
    await expect(reader.read(source())).rejects.toMatchObject({
      code: "SOURCE_BLOCKED",
    });
    expect(fetchImplementation).toHaveBeenCalledTimes(2);
  });

  it("blocks disallowed robots paths", async () => {
    const fetchImplementation = vi.fn(async (input: URL | RequestInfo) => {
      const url = String(input);
      if (url.endsWith("/robots.txt")) {
        return new Response("User-agent: *\nDisallow: /private", {
          headers: { "content-type": "text/plain" },
        });
      }
      return new Response("unexpected", {
        headers: { "content-type": "text/plain" },
      });
    });
    const reader = new WebsiteBrandSourceReader(
      publicDns,
      fetchImplementation as typeof fetch,
      () => now,
    );
    await expect(
      reader.read(source({ submittedUrl: "https://example.com/private" })),
    ).rejects.toMatchObject({ code: "SOURCE_BLOCKED", retryable: false });
  });

  it("rejects oversized and unsupported responses", async () => {
    const oversized = new WebsiteBrandSourceReader(
      publicDns,
      (async (input: URL | RequestInfo) => {
        if (String(input).endsWith("/robots.txt")) {
          return new Response("", { headers: { "content-type": "text/plain" } });
        }
        return new Response("small", {
          headers: {
            "content-type": "text/html",
            "content-length": String(3 * 1024 * 1024),
          },
        });
      }) as typeof fetch,
      () => now,
    );
    await expect(oversized.read(source())).rejects.toBeInstanceOf(BrandSourceReadError);

    const unsupported = new WebsiteBrandSourceReader(
      publicDns,
      (async (input: URL | RequestInfo) => {
        if (String(input).endsWith("/robots.txt")) {
          return new Response("", { headers: { "content-type": "text/plain" } });
        }
        return new Response("binary", { headers: { "content-type": "image/png" } });
      }) as typeof fetch,
      () => now,
    );
    await expect(unsupported.read(source())).rejects.toMatchObject({
      code: "SOURCE_UNSUPPORTED",
    });
  });
});
