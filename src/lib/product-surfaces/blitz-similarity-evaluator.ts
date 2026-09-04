import { z } from "zod";
import type { BlitzSimilarityMeasurementInput } from "./blitz-similarity-policy";

const measurementSchema = z.object({
  modality: z.enum(["text", "frame", "audio"]),
  coverage: z.enum(["compared", "source_absent", "candidate_absent", "both_absent"]),
  similarityBasisPoints: z.number().int().min(0).max(10_000).nullable(),
  sourceFingerprintDigest: z.string().regex(/^sha256:[a-f0-9]{64}$/).nullable(),
  candidateFingerprintDigest: z.string().regex(/^sha256:[a-f0-9]{64}$/).nullable(),
  algorithm: z.string().trim().min(1).max(120),
  algorithmVersion: z.string().trim().min(1).max(120),
}).strict();
const responseSchema = z.object({ evaluatorId: z.string().trim().min(1).max(200), evaluatorVersion: z.string().trim().min(1).max(200), measurements: z.array(measurementSchema).length(3) }).strict();

export interface BlitzSimilarityEvaluationRequest {
  source: { assetId: string; contentDigest: `sha256:${string}`; downloadUrl: string };
  candidate: { assetId: string; contentDigest: `sha256:${string}`; downloadUrl: string };
}
export interface BlitzSimilarityEvaluator {
  evaluate(input: BlitzSimilarityEvaluationRequest): Promise<{ evaluator: { id: string; version: string; qualificationDigest: `sha256:${string}` }; measurements: BlitzSimilarityMeasurementInput[] }>;
}

export class BlitzSimilarityEvaluatorError extends Error {
  constructor(readonly code: "BLITZ_SIMILARITY_EVALUATOR_UNAVAILABLE" | "BLITZ_SIMILARITY_EVALUATOR_RESPONSE_INVALID") { super(code); }
}

export function createConfiguredBlitzSimilarityEvaluator(input: { endpoint?: string; token?: string; evaluatorId?: string; evaluatorVersion?: string; qualificationDigest?: string; fetchImpl?: typeof fetch }): BlitzSimilarityEvaluator {
  const fetchImpl = input.fetchImpl ?? fetch;
  return { async evaluate(request) {
    if (!input.endpoint || !input.token || !input.evaluatorId || !input.evaluatorVersion || !/^sha256:[a-f0-9]{64}$/.test(input.qualificationDigest ?? "")) throw new BlitzSimilarityEvaluatorError("BLITZ_SIMILARITY_EVALUATOR_UNAVAILABLE");
    let endpoint: URL; try { endpoint = new URL(input.endpoint); } catch { throw new BlitzSimilarityEvaluatorError("BLITZ_SIMILARITY_EVALUATOR_UNAVAILABLE"); }
    if (process.env.NODE_ENV === "production" && endpoint.protocol !== "https:") throw new BlitzSimilarityEvaluatorError("BLITZ_SIMILARITY_EVALUATOR_UNAVAILABLE");
    const controller = new AbortController(); const timeout = setTimeout(() => controller.abort(), 20_000);
    let response: Response;
    try { response = await fetchImpl(endpoint, { method: "POST", headers: { authorization: `Bearer ${input.token}`, "content-type": "application/json" }, body: JSON.stringify({ schema: "blitz-similarity-evaluation/v1", ...request }), signal: controller.signal, cache: "no-store" }); }
    catch { throw new BlitzSimilarityEvaluatorError("BLITZ_SIMILARITY_EVALUATOR_UNAVAILABLE"); }
    finally { clearTimeout(timeout); }
    if (!response.ok || Number(response.headers.get("content-length") ?? 0) > 64_000) throw new BlitzSimilarityEvaluatorError("BLITZ_SIMILARITY_EVALUATOR_UNAVAILABLE");
    const parsed = responseSchema.safeParse(await response.json().catch(() => null));
    if (!parsed.success || parsed.data.evaluatorId !== input.evaluatorId || parsed.data.evaluatorVersion !== input.evaluatorVersion || new Set(parsed.data.measurements.map((measurement) => measurement.modality)).size !== 3) throw new BlitzSimilarityEvaluatorError("BLITZ_SIMILARITY_EVALUATOR_RESPONSE_INVALID");
    return { evaluator: { id: parsed.data.evaluatorId, version: parsed.data.evaluatorVersion, qualificationDigest: input.qualificationDigest as `sha256:${string}` }, measurements: parsed.data.measurements as BlitzSimilarityMeasurementInput[] };
  } };
}

export function productionBlitzSimilarityEvaluator() {
  return createConfiguredBlitzSimilarityEvaluator({ endpoint: process.env.BLITZ_SIMILARITY_EVALUATOR_URL, token: process.env.BLITZ_SIMILARITY_EVALUATOR_TOKEN, evaluatorId: process.env.BLITZ_SIMILARITY_EVALUATOR_ID, evaluatorVersion: process.env.BLITZ_SIMILARITY_EVALUATOR_VERSION, qualificationDigest: process.env.BLITZ_SIMILARITY_EVALUATOR_QUALIFICATION_DIGEST });
}
