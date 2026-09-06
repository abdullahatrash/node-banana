import { describe, expect, it, vi } from "vitest";
import type { CreatorPersonaRepository } from "../repository";
import { PersonaTrainingDispatcher } from "../training-dispatch";
import { ReplicatePersonaTrainingGateway } from "../training-provider";

const digest = `sha256:${"a".repeat(64)}` as const;
const claim = {
  workspaceId: "ws", id: "job", personaId: "persona", personaRevision: 5, previousState: "queued", state: "running", provider: "replicate", model: "owner/model", modelVersion: "base-version", qualificationDigest: digest, providerAcceptanceEvidenceId: "evidence", operationId: "persona_training:job", providerJobRef: null, resultModelRef: null, failureCode: null, requestedByUserId: "user", createdAt: new Date(), updatedAt: new Date(), invalidFailureCode: null,
  sources: [{ assetId: "asset-1", ordinal: 0, expectedChecksum: digest, checksum: digest, storageProvider: "s3", storageKey: "workspace/asset-1.png", deletedAt: null, metadata: { uploadState: "ready" } }],
};
const admission = () => ({ revalidate: vi.fn().mockResolvedValue({ kind: "admitted" }), releasePreStart: vi.fn(), settleSubmitted: vi.fn() });
const repository = (overrides: Record<string, unknown> = {}) => ({ materializeExpiredConsents: vi.fn().mockResolvedValue({ materialized: 0 }), claimTrainingDispatch: vi.fn().mockResolvedValue(claim), recordProviderTraining: vi.fn(), markTrainingOutcomeUnknown: vi.fn(), resolveTraining: vi.fn(), ...overrides });

describe("PersonaTrainingDispatcher", () => {
  it("submits once and persists the provider reference before waiting", async () => {
    const repo = repository();
    const provider = { submit: vi.fn().mockResolvedValue({ state: "queued", providerJobRef: "provider-job" }), recover: vi.fn() };
    const projection = { synchronize: vi.fn() };
    const dispatcher = new PersonaTrainingDispatcher(repo as unknown as CreatorPersonaRepository, provider, projection, admission(), vi.fn().mockResolvedValue({ downloadUrl: "https://signed.invalid/source", key: "key", expiresInSeconds: 3600 }), () => new Date("2026-09-04T12:00:00Z"));
    await expect(dispatcher.dispatchOne()).resolves.toEqual({ kind: "waiting_provider", trainingJobId: "job" });
    expect(provider.submit).toHaveBeenCalledWith(expect.objectContaining({ idempotencyKey: "job", sources: [{ assetId: "asset-1", checksum: digest, url: "https://signed.invalid/source" }] }));
    expect(repo.recordProviderTraining).toHaveBeenCalledWith(expect.objectContaining({ providerJobRef: "provider-job" }));
  });

  it("recovers stale submitted effects by stable idempotency key", async () => {
    const stale = { ...claim, previousState: "outcome_unknown", providerJobRef: null };
    const model = { schema: "creator-persona-model/v1", provider: "replicate", model: "owner/persona", version: "trained-version", inputSchemaDigest: digest, qualificationDigest: digest, trainingJobId: "job" } as const;
    const repo = repository({ claimTrainingDispatch: vi.fn().mockResolvedValue(stale), resolveTraining: vi.fn().mockResolvedValue({ state: "review" }) });
    const provider = { submit: vi.fn(), recover: vi.fn().mockResolvedValue({ state: "succeeded", providerJobRef: "provider-job", model }) };
    const projection = { synchronize: vi.fn() };
    const dispatcher = new PersonaTrainingDispatcher(repo as unknown as CreatorPersonaRepository, provider, projection, admission(), vi.fn(), () => new Date("2026-09-04T12:00:00Z"));
    await expect(dispatcher.dispatchOne()).resolves.toMatchObject({ kind: "succeeded", trainingJobId: "job" });
    expect(provider.submit).not.toHaveBeenCalled();
    expect(provider.recover).toHaveBeenCalledWith({ idempotencyKey: "job", providerJobRef: null });
    expect(repo.resolveTraining).toHaveBeenCalledWith(expect.objectContaining({ resultModelRef: model, idempotencyKey: "provider-training:job:succeeded" }));
  });

  it("holds ambiguous gateway failures for recovery", async () => {
    const repo = repository();
    const projection = { synchronize: vi.fn() };
    const dispatcher = new PersonaTrainingDispatcher(repo as unknown as CreatorPersonaRepository, { submit: vi.fn().mockRejectedValue(new Error("timeout")), recover: vi.fn() }, projection, admission(), vi.fn().mockResolvedValue({ downloadUrl: "https://signed.invalid/source" }), () => new Date("2026-09-04T12:00:00Z"));
    await expect(dispatcher.dispatchOne()).resolves.toEqual({ kind: "outcome_unknown", trainingJobId: "job" });
    expect(repo.markTrainingOutcomeUnknown).toHaveBeenCalledWith(expect.objectContaining({ trainingJobId: "job" }));
  });

  it("releases a reservation and never calls the provider when admission changed before submit", async () => {
    const repo = repository(); const guard = admission(); guard.revalidate.mockResolvedValue({ kind: "denied", code: "PROCESSING_REGION_EVIDENCE_CHANGED" });
    const provider = { submit: vi.fn(), recover: vi.fn() }; const projection = { synchronize: vi.fn() };
    const dispatcher = new PersonaTrainingDispatcher(repo as unknown as CreatorPersonaRepository, provider, projection, guard, vi.fn(), () => new Date("2026-09-04T12:00:00Z"));
    await expect(dispatcher.dispatchOne()).resolves.toMatchObject({ kind: "failed_known" });
    expect(guard.releasePreStart).toHaveBeenCalledWith(expect.objectContaining({ id: "job" }));
    expect(provider.submit).not.toHaveBeenCalled();
  });
});

describe("ReplicatePersonaTrainingGateway", () => {
  it("fails closed without a configured idempotent gateway", () => {
    expect(() => new ReplicatePersonaTrainingGateway({})).toThrow("PERSONA_TRAINING_CONFIGURATION_REQUIRED:REPLICATE_PERSONA_TRAINING_GATEWAY_URL");
  });
});
