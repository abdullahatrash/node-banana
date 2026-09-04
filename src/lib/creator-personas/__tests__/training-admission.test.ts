import { describe, expect, it, vi } from "vitest";
import { PersonaTrainingAdmissionService, type PersonaTrainingAdmissionRepository } from "../training-admission";
import type { CreatorPersona, CreatorPersonaEvidence } from "../types";
import type { PersonaTrainingQualification } from "../training-qualification";

const at = new Date("2026-09-04T12:00:00.000Z"); const digest = `sha256:${"a".repeat(64)}` as const;
const qualification = { schema: "creator-persona-training-qualification/v1", id: "qualification-1", revision: 2, provider: "replicate", model: "owner/trainer", version: "immutable-version", inputSchemaDigest: digest, providerPolicyVersion: "policy-1", contentLanguages: ["ar", "en"], arabicVarieties: ["gulf"], verifiedRegions: ["replicate-us"], priceUsd: { basis: "run", amount: 0.25 }, sourceContract: { minimum: 3, maximum: 20, mediaTypes: ["image"] }, pricingSource: { sourceUrl: "https://replicate.com/pricing", digest, checkedAt: at.toISOString() }, qualificationRun: { id: "qualification-run", digest, completedAt: at.toISOString() }, issuedAt: at.toISOString(), expiresAt: "2026-09-05T00:00:00.000Z", digest, signingKeyId: "key-1" } satisfies PersonaTrainingQualification;
const persona = (state: CreatorPersona["state"] = "ready_to_train") => ({ workspaceId: "ws", id: "persona", kind: "consented_likeness", state, name: "Creator", contentLanguage: "ar", arabicVariety: "gulf", disclosure: "AI Persona", revision: 4, reusableModelRef: null, retentionUntil: new Date("2027-01-01T00:00:00Z"), suspendedReasonCode: null, createdByUserId: "u", updatedByUserId: "u", createdAt: at, updatedAt: at, deletedAt: null }) satisfies CreatorPersona;
const evidence = (type: CreatorPersonaEvidence["type"], scope: Record<string, unknown> = {}) => ({ workspaceId: "ws", id: type, personaId: "persona", personaRevision: 3, type, issuer: type === "provider_acceptance" ? "provider_policy_registry" : type === "likeness_consent" ? "workspace_consent_officer" : "trust_review_service", subjectDigest: digest, scope, evidenceDigest: digest, provider: type === "provider_acceptance" ? "replicate" : null, providerPolicyVersion: type === "provider_acceptance" ? "policy-1" : null, effectiveAt: new Date("2026-09-01T00:00:00Z"), expiresAt: new Date("2026-10-01T00:00:00Z"), revokedAt: null, verifiedByUserId: "u", createdAt: at }) satisfies CreatorPersonaEvidence;
const accepted = evidence("provider_acceptance", { model: qualification.model, modelVersion: qualification.version, inputSchemaDigest: qualification.inputSchemaDigest, qualificationDigest: qualification.digest, acceptedUses: ["training"] });
const context = (state: CreatorPersona["state"] = "ready_to_train") => ({ persona: persona(state), evidence: [evidence("likeness_consent"), accepted, evidence("disclosure_review"), evidence("abuse_review")], sources: [1, 2, 3].map((value) => ({ assetId: `asset-${value}`, mediaType: "image" })), latestFailedTrainingJobId: state === "training_failed" ? "failed-job" : null });
const operations = () => ({ create: vi.fn().mockResolvedValue({ kind: "applied", operation: { revision: 1 } }), transition: vi.fn().mockResolvedValue({ kind: "applied", operation: { revision: 2 } }) });
const regions = { admit: vi.fn().mockResolvedValue({ kind: "admitted", evidence: { policyId: "policy", policyVersion: 2, evidenceDigest: digest, region: "replicate-us", routeId: "provider:replicate", evidenceExpiresAt: new Date("2026-09-05T00:00:00Z") } }), revalidate: vi.fn().mockResolvedValue({ kind: "admitted" }) };
const repository = (state: CreatorPersona["state"] = "ready_to_train", result?: Record<string, unknown>) => ({ getTrainingAdmissionContext: vi.fn().mockResolvedValue(context(state)), requestAdmittedTraining: vi.fn().mockResolvedValue(result ?? { trainingJobId: "new-job" }), getTrainingAdmissionPlan: vi.fn().mockResolvedValue(null), createTrainingAdmissionPlan: vi.fn(async (input: Parameters<PersonaTrainingAdmissionRepository["createTrainingAdmissionPlan"]>[0]) => input), getAdmittedTrainingReplay: vi.fn().mockResolvedValue(null) }) satisfies PersonaTrainingAdmissionRepository;

describe("Persona training admission", () => {
  it("returns an exact user-confirmable quote before reserving or creating a training job", async () => {
    const repo = repository();
    const budgets = { reserve: vi.fn().mockResolvedValue({ kind: "confirmation_required", quote: { quoteId: "quote" } }), release: vi.fn() };
    const service = new PersonaTrainingAdmissionService(repo, budgets as never, regions as never, operations() as never, () => [qualification], () => at);
    await expect(service.request({ workspaceId: "ws", userId: "u", personaId: "persona", expectedRevision: 4, idempotencyKey: "request-training" })).resolves.toMatchObject({ kind: "confirmation_required", quote: { quoteId: "quote" } });
    expect(repo.requestAdmittedTraining).not.toHaveBeenCalled();
  });

  it("server-selects the signed model, pins region/quote/reservation and links a failed retry", async () => {
    const repo = repository("training_failed");
    const budgets = { reserve: vi.fn().mockResolvedValue({ kind: "reserved", reservationIds: ["budget"], disposition: "created" }), release: vi.fn() };
    const op = operations(); const service = new PersonaTrainingAdmissionService(repo, budgets as never, regions as never, op as never, () => [qualification], () => at);
    await expect(service.request({ workspaceId: "ws", userId: "u", personaId: "persona", expectedRevision: 4, idempotencyKey: "retry-training", managedQuoteAcceptance: { quoteId: "quote", confirmationDigest: digest } })).resolves.toMatchObject({ kind: "admitted" });
    expect(budgets.reserve).toHaveBeenCalledWith(expect.objectContaining({ model: expect.objectContaining({ model: "owner/trainer", version: "immutable-version" }), quote: expect.objectContaining({ amount: 0.25, basis: "run", quantity: 1 }), fundingMode: "managed" }));
    expect(repo.requestAdmittedTraining).toHaveBeenCalledWith(expect.objectContaining({ retryOfJobId: "failed-job", admission: expect.objectContaining({ reservationIds: ["budget"], regionAdmission: expect.objectContaining({ region: "replicate-us" }), qualification: expect.objectContaining({ id: "qualification-1" }) }) }));
    expect(op.transition).toHaveBeenCalledWith(expect.objectContaining({ to: "admitted" }));
  });

  it("reuses the persisted quote window across explicit credit confirmation", async () => {
    let clock = at; let plan: Awaited<ReturnType<PersonaTrainingAdmissionRepository["getTrainingAdmissionPlan"]>> = null;
    const repo = repository(); repo.getTrainingAdmissionPlan.mockImplementation(async () => plan); repo.createTrainingAdmissionPlan.mockImplementation(async (input) => (plan = input));
    const budgets = { reserve: vi.fn().mockResolvedValueOnce({ kind: "confirmation_required", quote: { quoteId: "quote" } }).mockResolvedValueOnce({ kind: "reserved", reservationIds: ["budget"], disposition: "created" }), release: vi.fn() };
    const service = new PersonaTrainingAdmissionService(repo, budgets as never, regions as never, operations() as never, () => [qualification], () => clock);
    await service.request({ workspaceId: "ws", userId: "u", personaId: "persona", expectedRevision: 4, idempotencyKey: "stable-quote" });
    const firstExpiry = plan!.admission.quote.expiresAt.toISOString(); clock = new Date("2026-09-04T12:02:00.000Z");
    await service.request({ workspaceId: "ws", userId: "u", personaId: "persona", expectedRevision: 4, idempotencyKey: "stable-quote", managedQuoteAcceptance: { quoteId: "quote", confirmationDigest: digest } });
    expect(budgets.reserve.mock.calls[1]?.[0].quote.expiresAt.toISOString()).toBe(firstExpiry);
  });

  it("releases a newly-created hold when the durable Operation cannot be created", async () => {
    const repo = repository(); const budgets = { reserve: vi.fn().mockResolvedValue({ kind: "reserved", reservationIds: ["budget"], disposition: "created" }), release: vi.fn() };
    const op = { create: vi.fn().mockRejectedValue(new Error("database unavailable")), transition: vi.fn() };
    const service = new PersonaTrainingAdmissionService(repo, budgets as never, regions as never, op as never, () => [qualification], () => at);
    await expect(service.request({ workspaceId: "ws", userId: "u", personaId: "persona", expectedRevision: 4, idempotencyKey: "operation-down", managedQuoteAcceptance: { quoteId: "quote", confirmationDigest: digest } })).resolves.toEqual({ kind: "unavailable", code: "PERSONA_TRAINING_OPERATION_UNAVAILABLE" });
    expect(budgets.release).toHaveBeenCalledWith(expect.objectContaining({ intentId: expect.stringContaining("persona-training:") }));
    expect(repo.requestAdmittedTraining).not.toHaveBeenCalled();
  });
});
