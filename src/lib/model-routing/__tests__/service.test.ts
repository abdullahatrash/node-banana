import { describe, expect, it } from "vitest";
import { MemoryModelRoutingRepository } from "../memory-repository";
import { MemoryGenerationBudgetAuthority } from "../budget-authority";
import { ModelRoutingService } from "../service";
import { ALLOWING_TEST_REGION_AUTHORITY, resolveTestModel, testBrand, testRef, TEST_REMIX_BRIEF, TEST_RIGHTS } from "./fixtures";
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
    const repo = new MemoryModelRoutingRepository(); const service = new ModelRoutingService(repo, () => at, resolveTestModel, new MemoryGenerationBudgetAuthority(), ALLOWING_TEST_REGION_AUTHORITY); const source = testRef(4); const target = testRef(5);
    const issued = await service.issueAuthorization({ workspaceId: "ws", source, targets: [target], capability: "text_to_video", minimumQuality: "standard", contentLanguage: "ar", arabicVariety: "gulf", verifiedRegion: "replicate-us", executionMode: "async", maxTotalCostUsd: 0.5, expiresAt: new Date("2026-09-04T00:00:00Z"), userId: "u", idempotencyKey: "grant-0001" });
    expect(issued.kind).toBe("created");
    const result = await service.createIntent({ workspaceId: "ws", brand: testBrand("brand", 3, new Date("2026-09-02T00:00:00Z")), rawPrompt: "Arabic campaign", capability: "text_to_video", contentLanguage: "ar", arabicVariety: "gulf", rights: TEST_RIGHTS, remixBrief: TEST_REMIX_BRIEF, requestedModel: source, selectedModel: target, fallbackAuthorizationId: issued.authorization?.id ?? null, quantity: 8, userId: "u", idempotencyKey: "intent-001" });
    expect(result.kind).toBe("created"); expect(result.intent?.promptDigest).toMatch(/^sha256:/); expect(JSON.stringify(result.intent)).not.toContain("Arabic campaign"); expect(result.intent?.brand.revision).toBe(3); expect(result.intent?.arabicVariety).toBe("gulf"); expect(result.intent?.fundingMode).toBe("managed");
  });
  it("rejects silent fallback", async () => { const service = new ModelRoutingService(new MemoryModelRoutingRepository(), () => at, resolveTestModel, new MemoryGenerationBudgetAuthority(), ALLOWING_TEST_REGION_AUTHORITY); const result = await service.createIntent({ workspaceId: "ws", brand: testBrand("b", 1, at, `sha256:${"b".repeat(64)}`), rawPrompt: "x", capability: "text_to_image", contentLanguage: "en", arabicVariety: null, rights: TEST_RIGHTS, remixBrief: TEST_REMIX_BRIEF, requestedModel: testRef(0), selectedModel: testRef(2), fallbackAuthorizationId: null, quantity: 1, userId: "u", idempotencyKey: "intent-002" }); expect(result.kind).toBe("fallback_not_authorized"); });

  it("reserves an exact megapixel-priced quote and fails closed below its ceiling", async () => {
    const model = testRef(10);
    const command = { workspaceId: "ws", brand: testBrand("brand", 1, at), rawPrompt: "Arabic campaign", capability: "text_to_image" as const, contentLanguage: "ar" as const, arabicVariety: "msa" as const, rights: TEST_RIGHTS, remixBrief: TEST_REMIX_BRIEF, requestedModel: model, selectedModel: model, fallbackAuthorizationId: null, quantity: 1, pricingQuantities: [{ basis: "input_megapixel" as const, quantity: 2.0736 }, { basis: "output_megapixel" as const, quantity: 1 }], userId: "u" };
    const denied = await new ModelRoutingService(new MemoryModelRoutingRepository(), () => at, resolveTestModel, new MemoryGenerationBudgetAuthority(0.003), ALLOWING_TEST_REGION_AUTHORITY).createIntent({ ...command, idempotencyKey: "compound-denied" });
    expect(denied).toMatchObject({ kind: "budget_denied", code: "BUDGET_LIMIT_EXCEEDED" });
    const admitted = await new ModelRoutingService(new MemoryModelRoutingRepository(), () => at, resolveTestModel, new MemoryGenerationBudgetAuthority(0.003074), ALLOWING_TEST_REGION_AUTHORITY).createIntent({ ...command, idempotencyKey: "compound-admitted" });
    expect(admitted.intent?.quote).toMatchObject({ amount: 0.003074, basis: "run", quantity: 1, lineItems: [{ basis: "input_megapixel", quantity: 2.0736, maximumAmount: 0.002074 }, { basis: "output_megapixel", quantity: 1, maximumAmount: 0.001 }] });
  });

  it("persists the exact governed Persona snapshot on its generation intent", async () => {
    const service = new ModelRoutingService(new MemoryModelRoutingRepository(), () => at, resolveTestModel, new MemoryGenerationBudgetAuthority(), ALLOWING_TEST_REGION_AUTHORITY);
    const selected = testRef(5);
    const persona = { personaId: "persona", personaRevision: 9, purpose: "generation" as const, model: { ...selected, provider: "replicate" as const, qualificationDigest: `sha256:${"d".repeat(64)}` as const, trainingJobId: "training" }, disclosure: "AI Persona", evidence: { consentEvidenceId: "consent", providerAcceptanceEvidenceId: "acceptance", disclosureEvidenceId: "disclosure", abuseReviewEvidenceId: "abuse" } };
    const result = await service.createIntent({ workspaceId: "ws", brand: testBrand("brand", 1, at), rawPrompt: "campaign", capability: "text_to_video", contentLanguage: "en", arabicVariety: null, rights: TEST_RIGHTS, remixBrief: TEST_REMIX_BRIEF, requestedModel: selected, selectedModel: selected, fallbackAuthorizationId: null, persona, quantity: 8, userId: "u", idempotencyKey: "persona-intent" });
    expect(result.intent?.persona).toEqual(persona);
  });

  it("resolves price server-side and enforces cumulative fallback consumption", async () => {
    const repo = new MemoryModelRoutingRepository();
    const service = new ModelRoutingService(repo, () => at, resolveTestModel, new MemoryGenerationBudgetAuthority(), ALLOWING_TEST_REGION_AUTHORITY);
    const source = testRef(4); const target = testRef(5);
    const issued = await service.issueAuthorization({ workspaceId: "ws", source, targets: [target], capability: "text_to_video", minimumQuality: "standard", contentLanguage: "en", arabicVariety: null, verifiedRegion: "replicate-us", executionMode: "async", maxTotalCostUsd: 0.5, expiresAt: new Date("2026-09-04T00:00:00Z"), userId: "u", idempotencyKey: "grant-cumulative" });
    const common = { workspaceId: "ws", brand: testBrand("brand", 1, at, `sha256:${"c".repeat(64)}`), rawPrompt: "campaign", capability: "text_to_video" as const, contentLanguage: "en" as const, arabicVariety: null, rights: TEST_RIGHTS, remixBrief: TEST_REMIX_BRIEF, requestedModel: source, selectedModel: target, fallbackAuthorizationId: issued.authorization!.id, quantity: 8, userId: "u" };
    const first = await service.createIntent({ ...common, idempotencyKey: "intent-cumulative-1" });
    const second = await service.createIntent({ ...common, idempotencyKey: "intent-cumulative-2" });
    expect(first.kind).toBe("created");
    expect(first.intent?.quote).toMatchObject({ amount: 0.05, quantity: 8, basis: "second" });
    expect(second).toMatchObject({ kind: "fallback_incompatible", reasons: ["cost_ceiling"] });
  });
});
