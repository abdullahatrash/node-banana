import { describe, expect, it } from "vitest";
import { CURATED_MODELS } from "../catalog";
import { authorizeFallback } from "../compatibility";
import type { FallbackAuthorization } from "../types";
const at = new Date("2026-09-03T00:00:00Z"); const source = CURATED_MODELS[4]; const target = CURATED_MODELS[5];
function grant(overrides: Partial<FallbackAuthorization> = {}): FallbackAuthorization { return { schema: "model-fallback-authorization/v1", id: "grant", workspaceId: "ws", revision: 1, source, targets: [target], capability: "text_to_video", minimumQuality: "standard", contentLanguage: "ar", arabicVariety: "gulf", verifiedRegion: "replicate-us", executionMode: "async", maxTotalCostUsd: 0.5, issuedByUserId: "u", issuedAt: at, expiresAt: new Date("2026-09-04T00:00:00Z"), revokedAt: null, revokedByUserId: null, ...overrides }; }
const quote = { currency: "USD" as const, amount: 0.05, basis: "second" as const, quantity: 8, quotedAt: at, expiresAt: new Date("2026-09-03T00:05:00Z") };
describe("fallback compatibility", () => {
  it("permits only an exact, compatible, bounded target", () => { expect(authorizeFallback({ authorization: grant(), target, quote, at })).toEqual({ authorized: true }); });
  it("fails closed on region, Arabic variety, expiry, revocation and cost", () => { const result = authorizeFallback({ authorization: grant({ verifiedRegion: "eu", arabicVariety: "gulf", revokedAt: at }), target, quote: { ...quote, quantity: 20 }, at: new Date("2026-09-05T00:00:00Z") }); expect(result.authorized).toBe(false); if (!result.authorized) expect(result.reasons).toEqual(expect.arrayContaining(["revoked", "expired", "region", "quote_expired", "cost_ceiling"])); });
});
