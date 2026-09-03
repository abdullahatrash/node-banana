import { describe, expect, it, vi } from "vitest";
import { CURATED_MODELS } from "../catalog";
import { ReplicatePredictionAdapter } from "../replicate-contract";
import type { GenerationIntent } from "../types";

const intent: GenerationIntent = {
  schema: "generation-intent/v1", id: "intent", workspaceId: "ws",
  brand: { profileId: "b", revision: 1, digest: `sha256:${"a".repeat(64)}`, acceptedAt: new Date() },
  promptDigest: `sha256:${"b".repeat(64)}`, capability: "text_to_video", contentLanguage: "ar", arabicVariety: "msa",
  rights: { basis: "owned", evidenceRefs: [], sourceUrls: [] }, requestedModel: CURATED_MODELS[5], selectedModel: CURATED_MODELS[5], fallbackAuthorizationId: null,
  quote: { currency: "USD", amount: .05, basis: "second", quantity: 5, quotedAt: new Date(), expiresAt: new Date(Date.now() + 1000) },
  reservationId: "r", createdByUserId: "u", createdAt: new Date(),
};

describe("ReplicatePredictionAdapter mocked contract", () => {
  it("persists prediction identity before canonical artifact ingestion", async () => {
    const order: string[] = [];
    const adapter = new ReplicatePredictionAdapter(
      { create: vi.fn(async () => ({ id: "pred", status: "succeeded" as const, output: ["url"] })), get: vi.fn(), cancel: vi.fn() },
      { persist: vi.fn(async () => { order.push("persist"); return "created" as const; }) },
      { ingest: vi.fn(async () => { order.push("ingest"); return { artifactIds: ["artifact"] }; }) },
    );
    const result = await adapter.submit(intent, { prompt: "not persisted here" });
    expect(order).toEqual(["persist", "ingest"]);
    expect(result).toEqual({ state: "succeeded", predictionId: "pred", artifactIds: ["artifact"] });
  });

  it("maps aborted to cancelled and transport loss to outcome_unknown without retry", async () => {
    const create = vi.fn(async () => ({ id: "p", status: "aborted" as const }));
    const adapter = new ReplicatePredictionAdapter(
      { create, get: vi.fn(async () => { throw new Error("network"); }), cancel: vi.fn() },
      { persist: vi.fn(async () => "created" as const) }, { ingest: vi.fn() },
    );
    expect(await adapter.submit(intent, {})).toEqual({ state: "cancelled", predictionId: "p" });
    expect((await adapter.poll(intent, "p")).state).toBe("outcome_unknown");
    expect(create).toHaveBeenCalledTimes(1);
  });
});
