import { getPairingClientRateLimitKey } from "../request-client";

describe("pairing requester rate-limit key", () => {
  beforeEach(() => {
    vi.stubEnv("PAIRING_TRUSTED_PROXY", "");
    vi.stubEnv("TRUST_PROXY_HEADERS", "");
    vi.stubEnv("CF_PAGES", "");
    vi.stubEnv("VERCEL", "");
    vi.stubEnv("VERCEL_ENV", "");
    vi.stubEnv("FLY_APP_NAME", "");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("accepts only the explicitly trusted vendor proxy family", () => {
    process.env.PAIRING_TRUSTED_PROXY = "cloudflare";
    expect(
      getPairingClientRateLimitKey(
        new Headers({
          "cf-ray": "abc",
          "cf-connecting-ip": "203.0.113.10",
          "x-forwarded-for": "198.51.100.5",
        }),
      ),
    ).toBe("ip:203.0.113.10");
  });

  it("ignores vendor-looking and generic headers outside a trusted deployment", () => {
    expect(
      getPairingClientRateLimitKey(
        new Headers({
          "cf-ray": "attacker-supplied",
          "cf-connecting-ip": "203.0.113.10",
          "x-vercel-id": "attacker-supplied",
          "x-forwarded-for": "198.51.100.5",
          "fly-request-id": "attacker-supplied",
          "fly-client-ip": "192.0.2.7",
        }),
      ),
    ).toBe("shared-unattributed-client");
  });

  it("supports explicitly trusted generic proxy headers with first-hop parsing", () => {
    process.env.PAIRING_TRUSTED_PROXY = "generic";
    expect(
      getPairingClientRateLimitKey(
        new Headers({
          "x-forwarded-for": "198.51.100.5, 10.0.0.1",
        }),
      ),
    ).toBe("ip:198.51.100.5");
  });
});
