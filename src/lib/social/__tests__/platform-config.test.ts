/**
 * Tests for per-platform server OAuth credential configuration checks.
 *
 * These never assert on env var *values* — only presence — since the whole
 * point of this module is to report configured status without leaking
 * secrets.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { isPlatformConfigured } from "@/lib/social/platform-config";

describe("isPlatformConfigured", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns false for x when X_API_KEY / X_API_SECRET are unset", () => {
    expect(isPlatformConfigured("x")).toBe(false);
  });

  it("returns true for x when both X_API_KEY and X_API_SECRET are set", () => {
    vi.stubEnv("X_API_KEY", "key");
    vi.stubEnv("X_API_SECRET", "secret");
    expect(isPlatformConfigured("x")).toBe(true);
  });

  it("returns false when only one of two required vars is set", () => {
    vi.stubEnv("LINKEDIN_CLIENT_ID", "id");
    // LINKEDIN_CLIENT_SECRET intentionally left unset
    expect(isPlatformConfigured("linkedin")).toBe(false);
  });

  it("treats blank/whitespace-only env vars as not configured", () => {
    vi.stubEnv("PINTEREST_CLIENT_ID", "   ");
    vi.stubEnv("PINTEREST_CLIENT_SECRET", "secret");
    expect(isPlatformConfigured("pinterest")).toBe(false);
  });

  it("shares META_APP_ID/META_APP_SECRET across instagram, facebook, and threads", () => {
    vi.stubEnv("META_APP_ID", "id");
    vi.stubEnv("META_APP_SECRET", "secret");
    expect(isPlatformConfigured("instagram")).toBe(true);
    expect(isPlatformConfigured("facebook")).toBe(true);
    expect(isPlatformConfigured("threads")).toBe(true);
  });

  it("returns true for bluesky and mastodon regardless of env (no server credentials required)", () => {
    expect(isPlatformConfigured("bluesky")).toBe(true);
    expect(isPlatformConfigured("mastodon")).toBe(true);
  });
});
