import { describe, expect, it, vi } from "vitest";
import { BlitzSimilarityEvaluatorError, createConfiguredBlitzSimilarityEvaluator } from "../blitz-similarity-evaluator";

const digest = `sha256:${"a".repeat(64)}` as const;
const request = { source: { assetId: "source", contentDigest: digest, mediaType: "video" as const, downloadUrl: "https://signed.test/source" }, candidate: { assetId: "candidate", contentDigest: digest, mediaType: "video" as const, downloadUrl: "https://signed.test/candidate" } };

describe("configured Blitz similarity evaluator", () => {
  it("fails closed when the qualified evaluator is not configured", async () => {
    await expect(createConfiguredBlitzSimilarityEvaluator({}).evaluate(request)).rejects.toMatchObject({ code: "BLITZ_SIMILARITY_EVALUATOR_UNAVAILABLE" });
  });

  it("accepts only the pinned evaluator identity and complete modality matrix", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ evaluatorId: "similarity-prod", evaluatorVersion: "2026-09-04", measurements: ["text", "frame", "audio"].map((modality) => ({ modality, coverage: "compared", similarityBasisPoints: 1000, sourceFingerprintDigest: digest, candidateFingerprintDigest: digest, algorithm: `${modality}-fingerprint`, algorithmVersion: "1" })) }), { status: 200, headers: { "content-type": "application/json" } }));
    const evaluator = createConfiguredBlitzSimilarityEvaluator({ endpoint: "https://evaluator.test/v1/compare", token: "secret", evaluatorId: "similarity-prod", evaluatorVersion: "2026-09-04", qualificationDigest: digest, fetchImpl });
    await expect(evaluator.evaluate(request)).resolves.toMatchObject({ evaluator: { id: "similarity-prod", qualificationDigest: digest }, measurements: [{ modality: "text" }, { modality: "frame" }, { modality: "audio" }] });
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it("rejects an identity substitution", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ evaluatorId: "other", evaluatorVersion: "1", measurements: [] }), { status: 200 }));
    const evaluator = createConfiguredBlitzSimilarityEvaluator({ endpoint: "https://evaluator.test", token: "secret", evaluatorId: "expected", evaluatorVersion: "1", qualificationDigest: digest, fetchImpl });
    await expect(evaluator.evaluate(request)).rejects.toBeInstanceOf(BlitzSimilarityEvaluatorError);
  });
});
