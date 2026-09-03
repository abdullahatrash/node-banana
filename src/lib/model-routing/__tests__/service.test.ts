import { describe, expect, it } from "vitest";
import { MemoryModelRoutingRepository } from "../memory-repository";
import { MemoryGenerationBudgetAuthority } from "../budget-authority";
import { ModelRoutingService } from "../service";
import { resolveTestModel, testRef, TEST_REMIX_BRIEF, TEST_RIGHTS } from "./fixtures";
const at = new Date("2026-09-03T00:00:00Z");
describe("ModelRoutingService", () => {
  it("counts settled actual spend toward the hard generation ceiling", async () => {
    const budget = new MemoryGenerationBudgetAuthority(1);
    const quote = { currency: "USD" as const, amount: 0.1, basis: "second" as const, quantity: 6, quotedAt: at, expiresAt: new Date(at.getTime() + 60_000) };
    expect((await budget.reserve({ workspaceId: "ws", principalId: "u", intentId: "one", model: testRef(5), quote, at })).kind).toBe("reserved");
    const first = budget.reservations.get("ws:one")!; budget.reservations.set("ws:one", { ...first, status: "settled", actualAmount: 0.6 });
    expect(await budget.reserve({ workspaceId: "ws", principalId: "u", intentId: "two", model: testRef(5), quote: { ...quote, quantity: 5 }, at })).toMatchObject({ kind: "denied", code: "BUDGET_LIMIT_EXCEEDED" });
  });
  it("requires explicit authorization and pins brand, locale, rights, model, quote and reservation", async () => {
    const repo = new MemoryModelRoutingRepository(); const service = new ModelRoutingService(repo, () => at, resolveTestModel, new MemoryGenerationBudgetAuthority()); const source = testRef(4); const target = testRef(5);
    const issued = await service.issueAuthorization({ workspaceId: "ws", source, targets: [target], capability: "text_to_video", minimumQuality: "standard", contentLanguage: "ar", arabicVariety: "gulf", verifiedRegion: "replicate-us", executionMode: "async", maxTotalCostUsd: 0.5, expiresAt: new Date("2026-09-04T00:00:00Z"), userId: "u", idempotencyKey: "grant-0001" });
    expect(issued.kind).toBe("created");
    const result = await service.createIntent({ workspaceId: "ws", brand: { profileId: "brand", revision: 3, digest: `sha256:${"a".repeat(64)}`, acceptedAt: new Date("2026-09-02T00:00:00Z") }, rawPrompt: "Arabic campaign", capability: "text_to_video", contentLanguage: "ar", arabicVariety: "gulf", rights: TEST_RIGHTS, remixBrief: TEST_REMIX_BRIEF, requestedModel: source, selectedModel: target, fallbackAuthorizationId: issued.authorization?.id ?? null, quantity: 8, userId: "u", idempotencyKey: "intent-001" });
    expect(result.kind).toBe("created"); expect(result.intent?.promptDigest).toMatch(/^sha256:/); expect(JSON.stringify(result.intent)).not.toContain("Arabic campaign"); expect(result.intent?.brand.revision).toBe(3); expect(result.intent?.arabicVariety).toBe("gulf");
  });
  it("rejects silent fallback", async () => { const service = new ModelRoutingService(new MemoryModelRoutingRepository(), () => at, resolveTestModel, new MemoryGenerationBudgetAuthority()); const result = await service.createIntent({ workspaceId: "ws", brand: { profileId: "b", revision: 1, digest: `sha256:${"b".repeat(64)}`, acceptedAt: at }, rawPrompt: "x", capability: "text_to_image", contentLanguage: "en", arabicVariety: null, rights: TEST_RIGHTS, remixBrief: TEST_REMIX_BRIEF, requestedModel: testRef(0), selectedModel: testRef(2), fallbackAuthorizationId: null, quantity: 1, userId: "u", idempotencyKey: "intent-002" }); expect(result.kind).toBe("fallback_not_authorized"); });

  it("resolves price server-side and enforces cumulative fallback consumption", async () => {
    const repo = new MemoryModelRoutingRepository();
    const service = new ModelRoutingService(repo, () => at, resolveTestModel, new MemoryGenerationBudgetAuthority());
    const source = testRef(4); const target = testRef(5);
    const issued = await service.issueAuthorization({ workspaceId: "ws", source, targets: [target], capability: "text_to_video", minimumQuality: "standard", contentLanguage: "en", arabicVariety: null, verifiedRegion: "replicate-us", executionMode: "async", maxTotalCostUsd: 0.5, expiresAt: new Date("2026-09-04T00:00:00Z"), userId: "u", idempotencyKey: "grant-cumulative" });
    const common = { workspaceId: "ws", brand: { profileId: "brand", revision: 1, digest: `sha256:${"c".repeat(64)}` as `sha256:${string}`, acceptedAt: at }, rawPrompt: "campaign", capability: "text_to_video" as const, contentLanguage: "en" as const, arabicVariety: null, rights: TEST_RIGHTS, remixBrief: TEST_REMIX_BRIEF, requestedModel: source, selectedModel: target, fallbackAuthorizationId: issued.authorization!.id, quantity: 8, userId: "u" };
    const first = await service.createIntent({ ...common, idempotencyKey: "intent-cumulative-1" });
    const second = await service.createIntent({ ...common, idempotencyKey: "intent-cumulative-2" });
    expect(first.kind).toBe("created");
    expect(first.intent?.quote).toMatchObject({ amount: 0.05, quantity: 8, basis: "second" });
    expect(second).toMatchObject({ kind: "fallback_incompatible", reasons: ["cost_ceiling"] });
  });
});
