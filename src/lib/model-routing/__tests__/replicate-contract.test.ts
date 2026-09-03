import { describe, expect, it, vi } from "vitest";
import { ReplicatePredictionAdapter } from "../replicate-contract";
import type { GenerationIntent } from "../types";
import { resolveTestModel, testOutputContract, testQualification, testRef, TEST_CREDENTIAL_REF, TEST_REGION_ADMISSION, TEST_RIGHTS } from "./fixtures";

const intent: GenerationIntent = {
  schema: "generation-intent/v1", id: "intent", workspaceId: "ws",
  brand: { profileId: "b", revision: 1, digest: `sha256:${"a".repeat(64)}`, acceptedAt: new Date() },
  promptDigest: `sha256:${"b".repeat(64)}`, capability: "text_to_video", contentLanguage: "ar", arabicVariety: "msa",
  rights: TEST_RIGHTS, remixBrief: { digest: `sha256:${"e".repeat(64)}`, preserve: [], transform: [], avoid: [] }, qualification: testQualification(5), regionAdmission: TEST_REGION_ADMISSION, outputContract: testOutputContract(5, 5), requestedModel: testRef(5), selectedModel: testRef(5), fallbackAuthorizationId: null,
  quote: { currency: "USD", amount: .05, basis: "second", quantity: 5, quotedAt: new Date(), expiresAt: new Date(Date.now() + 1000) },
  reservationIds: ["r"], createdByUserId: "u", createdAt: new Date(),
};

function effectClaims(order: string[] = []) {
  let state: "empty" | "claimed" | "submitted" | "outcome_unknown" = "empty";
  let predictionId: string | null = null;
  return {
    claim: vi.fn(async () => state === "empty" ? (state = "claimed", { kind: "claimed" as const }) : ({ kind: "existing" as const, state, predictionId })),
    bindPrediction: vi.fn(async (input: { predictionId: string }) => { state = "submitted"; predictionId = input.predictionId; order.push("persist"); return "bound" as const; }),
    markOutcomeUnknown: vi.fn(async () => { state = "outcome_unknown"; }),
  };
}

describe("ReplicatePredictionAdapter mocked contract", () => {
  it("persists prediction identity before canonical artifact ingestion", async () => {
    const order: string[] = [];
    const adapter = new ReplicatePredictionAdapter(
      { create: vi.fn(async () => ({ id: "pred", status: "succeeded" as const, version: intent.selectedModel.version, output: ["url"] })), get: vi.fn(), cancel: vi.fn() },
      effectClaims(order),
      { ingest: vi.fn(async () => { order.push("ingest"); return { artifactIds: ["artifact"] }; }) },
      TEST_CREDENTIAL_REF,
      undefined,
      resolveTestModel,
    );
    const result = await adapter.submit(intent, { prompt: "not persisted here" });
    expect(order).toEqual(["persist", "ingest"]);
    expect(result).toEqual({ state: "succeeded", predictionId: "pred", artifactIds: ["artifact"] });
  });

  it("maps aborted to cancelled and transport loss to outcome_unknown without retry", async () => {
    const create = vi.fn(async () => ({ id: "p", status: "aborted" as const, version: intent.selectedModel.version }));
    const adapter = new ReplicatePredictionAdapter(
      { create, get: vi.fn(async () => { throw new Error("network"); }), cancel: vi.fn() },
      effectClaims(), { ingest: vi.fn() }, TEST_CREDENTIAL_REF, undefined, resolveTestModel,
    );
    expect(await adapter.submit(intent, {})).toEqual({ state: "cancelled", predictionId: "p" });
    expect((await adapter.poll(intent, "p")).state).toBe("outcome_unknown");
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("claims before create and concurrent/retry submissions never create twice", async () => {
    const effects = effectClaims();
    const create = vi.fn(async () => ({ id: "p", status: "processing" as const, version: intent.selectedModel.version }));
    const adapter = new ReplicatePredictionAdapter(
      { create, get: vi.fn(), cancel: vi.fn() }, effects, { ingest: vi.fn() }, TEST_CREDENTIAL_REF, undefined, resolveTestModel,
    );
    expect((await adapter.submit(intent, {})).state).toBe("waiting_provider");
    expect(await adapter.submit(intent, {})).toEqual({ state: "waiting_provider", predictionId: "p", code: "SUBMISSION_ALREADY_EXISTS" });
    expect(create).toHaveBeenCalledTimes(1);
    expect(effects.claim.mock.invocationCallOrder[0]).toBeLessThan(create.mock.invocationCallOrder[0]!);
  });

  it("records ambiguous submission and never resubmits it", async () => {
    const effects = effectClaims();
    const create = vi.fn(async () => { throw new Error("transport lost"); });
    const adapter = new ReplicatePredictionAdapter(
      { create, get: vi.fn(), cancel: vi.fn() }, effects, { ingest: vi.fn() }, TEST_CREDENTIAL_REF, undefined, resolveTestModel,
    );
    expect((await adapter.submit(intent, {})).state).toBe("outcome_unknown");
    expect((await adapter.submit(intent, {})).state).toBe("outcome_unknown");
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("never treats an unreported or different executed version as the pinned model", async () => {
    const effects = effectClaims();
    const adapter = new ReplicatePredictionAdapter(
      { create: vi.fn(async () => ({ id: "p-version", status: "processing" as const, version: "different-version" })), get: vi.fn(), cancel: vi.fn() },
      effects, { ingest: vi.fn() }, TEST_CREDENTIAL_REF, undefined, resolveTestModel,
    );
    expect(await adapter.submit(intent, {})).toMatchObject({ state: "outcome_unknown", predictionId: "p-version", code: "EXECUTED_VERSION_UNVERIFIED" });
    expect(effects.bindPrediction).toHaveBeenCalledWith(expect.objectContaining({ executedVersion: "different-version", credentialRef: TEST_CREDENTIAL_REF }));
  });
});
