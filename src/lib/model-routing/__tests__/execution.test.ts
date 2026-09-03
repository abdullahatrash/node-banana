import { describe, expect, it, vi } from "vitest";
import { MemoryOperationStatusRepository } from "@/lib/agent-runtime/operation-status/memory-repository";
import { OperationStatusService } from "@/lib/agent-runtime/operation-status/service";
import { MemoryModelRoutingRepository } from "../memory-repository";
import { ReplicatePredictionAdapter } from "../replicate-contract";
import { GenerationExecutionService } from "../execution";
import { ALLOWING_TEST_REGION_AUTHORITY, resolveTestModel, testOutputContract, testRef, TEST_CREDENTIAL_REF, TEST_REGION_ADMISSION, TEST_RIGHTS } from "./fixtures";
import type { GenerationIntent } from "../types";
import { canonicalDigest } from "@/lib/agent-tools/canonical";

const at = new Date("2026-09-03T00:00:00Z");
const intent: GenerationIntent = { schema: "generation-intent/v1", id: "intent", workspaceId: "ws", brand: { profileId: "brand", revision: 2, digest: `sha256:${"a".repeat(64)}`, acceptedAt: at }, promptDigest: canonicalDigest("Arabic campaign") as `sha256:${string}`, capability: "text_to_video", contentLanguage: "ar", arabicVariety: "gulf", rights: TEST_RIGHTS, remixBrief: { digest: `sha256:${"e".repeat(64)}`, preserve: [], transform: [], avoid: [] }, regionAdmission: TEST_REGION_ADMISSION, outputContract: testOutputContract(5), requestedModel: testRef(5), selectedModel: testRef(5), fallbackAuthorizationId: null, quote: { currency: "USD", amount: .05, basis: "second", quantity: 8, quotedAt: at, expiresAt: new Date("2026-09-03T00:05:00Z") }, reservationIds: ["budget"], createdByUserId: "user", createdAt: at };

describe("GenerationExecutionService", () => {
  it("requires the sealed prompt and projects admitted provider work durably", async () => {
    const routing = new MemoryModelRoutingRepository();
    await routing.createIntent(intent, "intent-seed", "sha256:seed");
    const create = vi.fn(async () => ({ id: "prediction", status: "processing" as const, version: intent.selectedModel.version }));
    const provider = new ReplicatePredictionAdapter(
      { create, get: vi.fn(), cancel: vi.fn() },
      { claim: vi.fn(async () => ({ kind: "claimed" as const })), bindPrediction: vi.fn(async () => "bound" as const), markOutcomeUnknown: vi.fn() },
      { ingest: vi.fn() }, TEST_CREDENTIAL_REF, () => at, resolveTestModel,
    );
    const service = new GenerationExecutionService(routing, new OperationStatusService(new MemoryOperationStatusRepository(), () => at), provider, () => at, resolveTestModel, ALLOWING_TEST_REGION_AUTHORITY);
    const rejected = await service.execute({ workspaceId: "ws", userId: "user", intentId: "intent", rawPrompt: "wrong", sourceUrls: [], idempotencyKey: "execute-wrong" });
    expect(rejected.kind === "accepted" ? null : rejected.code).toBe("PROMPT_DIGEST_MISMATCH");
    const result = await service.execute({ workspaceId: "ws", userId: "user", intentId: "intent", rawPrompt: "Arabic campaign", sourceUrls: [], idempotencyKey: "execute-right" });
    expect(result.kind).toBe("accepted");
    if (result.kind === "accepted") expect(result.operation).toMatchObject({ state: "waiting_provider", revision: 4, metadata: { predictionId: "prediction", contentLanguage: "ar", arabicVariety: "gulf" } });
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ input: expect.objectContaining({ prompt: "Arabic campaign", aspect_ratio: "9:16", duration: 8, disable_safety_checker: false, resolution: "1080p", audio: false }) }));
  });
});
