import { describe, expect, it } from "vitest";
import { CURATED_MODELS } from "../catalog";
import { MemoryModelRoutingRepository } from "../memory-repository";
import { ModelRoutingService } from "../service";
const at = new Date("2026-09-03T00:00:00Z");
describe("ModelRoutingService", () => {
  it("requires explicit authorization and pins brand, locale, rights, model, quote and reservation", async () => {
    const repo = new MemoryModelRoutingRepository(); const service = new ModelRoutingService(repo, () => at); const source = CURATED_MODELS[4]; const target = CURATED_MODELS[5];
    const issued = await service.issueAuthorization({ workspaceId: "ws", source, targets: [target], capability: "text_to_video", minimumQuality: "standard", contentLanguage: "ar", arabicVariety: "gulf", verifiedRegion: "replicate-us", executionMode: "async", maxTotalCostUsd: 0.5, expiresAt: new Date("2026-09-04T00:00:00Z"), userId: "u", idempotencyKey: "grant-0001" });
    expect(issued.kind).toBe("created");
    const result = await service.createIntent({ workspaceId: "ws", brand: { profileId: "brand", revision: 3, digest: `sha256:${"a".repeat(64)}`, acceptedAt: new Date("2026-09-02T00:00:00Z") }, rawPrompt: "Arabic campaign", capability: "text_to_video", contentLanguage: "ar", arabicVariety: "gulf", rights: { basis: "owned", evidenceRefs: ["asset-1"], sourceUrls: [] }, requestedModel: source, selectedModel: target, fallbackAuthorizationId: issued.authorization?.id ?? null, quote: { currency: "USD", amount: 0.05, basis: "second", quantity: 8, quotedAt: at, expiresAt: new Date("2026-09-03T00:05:00Z") }, reservationId: "reservation-1", userId: "u", idempotencyKey: "intent-001" });
    expect(result.kind).toBe("created"); expect(result.intent?.promptDigest).toMatch(/^sha256:/); expect(JSON.stringify(result.intent)).not.toContain("Arabic campaign"); expect(result.intent?.brand.revision).toBe(3); expect(result.intent?.arabicVariety).toBe("gulf");
  });
  it("rejects silent fallback", async () => { const service = new ModelRoutingService(new MemoryModelRoutingRepository(), () => at); const result = await service.createIntent({ workspaceId: "ws", brand: { profileId: "b", revision: 1, digest: `sha256:${"b".repeat(64)}`, acceptedAt: at }, rawPrompt: "x", capability: "text_to_image", contentLanguage: "en", arabicVariety: null, rights: { basis: "owned", evidenceRefs: [], sourceUrls: [] }, requestedModel: CURATED_MODELS[0], selectedModel: CURATED_MODELS[2], fallbackAuthorizationId: null, quote: { currency: "USD", amount: .067, basis: "image", quantity: 1, quotedAt: at, expiresAt: new Date("2026-09-03T00:05:00Z") }, reservationId: "r", userId: "u", idempotencyKey: "intent-002" }); expect(result.kind).toBe("fallback_not_authorized"); });
});
