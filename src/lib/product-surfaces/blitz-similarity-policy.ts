import { canonicalDigest } from "@/lib/agent-tools/canonical";

export const BLITZ_SIMILARITY_MODALITIES = ["text", "frame", "audio"] as const;
export type BlitzSimilarityModality = (typeof BLITZ_SIMILARITY_MODALITIES)[number];
export type BlitzSimilarityCoverage = "compared" | "source_absent" | "candidate_absent" | "both_absent";

const THRESHOLD_BASIS_POINTS: Record<BlitzSimilarityModality, number> = {
  text: 6_500,
  frame: 8_200,
  audio: 7_500,
};

export interface BlitzSimilarityMeasurementInput {
  modality: BlitzSimilarityModality;
  algorithm: string;
  algorithmVersion: string;
  coverage: BlitzSimilarityCoverage;
  similarityBasisPoints: number | null;
  sourceFingerprintDigest: `sha256:${string}` | null;
  candidateFingerprintDigest: `sha256:${string}` | null;
}

export interface BlitzSimilarityGateEvidence {
  schema: "blitz-similarity-gate/v1";
  policyVersion: "blitz-similarity-policy/2026-09-04";
  sourceAsset: { id: string; contentDigest: `sha256:${string}` };
  candidateAsset: { id: string; contentDigest: `sha256:${string}` };
  measurements: Array<BlitzSimilarityMeasurementInput & { maximumBasisPoints: number; passed: boolean }>;
  status: "passed" | "blocked";
  evaluatedAt: string;
  evaluator: { kind: "qualified_internal"; adapterId: string; adapterVersion: string };
  digest: `sha256:${string}`;
}

function measurementPassed(measurement: BlitzSimilarityMeasurementInput): boolean {
  if (measurement.coverage === "compared") {
    return measurement.similarityBasisPoints !== null
      && measurement.sourceFingerprintDigest !== null
      && measurement.candidateFingerprintDigest !== null
      && Number.isInteger(measurement.similarityBasisPoints)
      && measurement.similarityBasisPoints >= 0
      && measurement.similarityBasisPoints <= THRESHOLD_BASIS_POINTS[measurement.modality];
  }
  return measurement.similarityBasisPoints === null;
}

export function buildBlitzSimilarityGate(input: {
  sourceAsset: BlitzSimilarityGateEvidence["sourceAsset"];
  candidateAsset: BlitzSimilarityGateEvidence["candidateAsset"];
  measurements: BlitzSimilarityMeasurementInput[];
  evaluatedAt: Date;
  evaluator: BlitzSimilarityGateEvidence["evaluator"];
}): BlitzSimilarityGateEvidence {
  const byModality = new Map(input.measurements.map((measurement) => [measurement.modality, measurement]));
  if (byModality.size !== BLITZ_SIMILARITY_MODALITIES.length || input.measurements.length !== BLITZ_SIMILARITY_MODALITIES.length) throw new Error("BLITZ_SIMILARITY_COVERAGE_INCOMPLETE");
  const measurements = BLITZ_SIMILARITY_MODALITIES.map((modality) => {
    const measurement = byModality.get(modality);
    if (!measurement || !measurement.algorithm.trim() || !measurement.algorithmVersion.trim()) throw new Error("BLITZ_SIMILARITY_MEASUREMENT_INVALID");
    return { ...measurement, maximumBasisPoints: THRESHOLD_BASIS_POINTS[modality], passed: measurementPassed(measurement) };
  });
  const facts = {
    schema: "blitz-similarity-gate/v1" as const,
    policyVersion: "blitz-similarity-policy/2026-09-04" as const,
    sourceAsset: input.sourceAsset,
    candidateAsset: input.candidateAsset,
    measurements,
    status: measurements.every((measurement) => measurement.passed) ? "passed" as const : "blocked" as const,
    evaluatedAt: input.evaluatedAt.toISOString(),
    evaluator: input.evaluator,
  };
  return { ...facts, digest: canonicalDigest(facts) };
}

export function validateBlitzSimilarityGate(input: {
  evidence: BlitzSimilarityGateEvidence | null;
  sourceAsset: BlitzSimilarityGateEvidence["sourceAsset"];
  candidateAsset: BlitzSimilarityGateEvidence["candidateAsset"];
}): { ok: true } | { ok: false; code: "BLITZ_SIMILARITY_REQUIRED" | "BLITZ_SIMILARITY_IDENTITY_MISMATCH" | "BLITZ_SIMILARITY_EVIDENCE_INVALID" | "BLITZ_SIMILARITY_BLOCKED" } {
  const { evidence } = input;
  if (!evidence) return { ok: false, code: "BLITZ_SIMILARITY_REQUIRED" };
  if (evidence.sourceAsset.id !== input.sourceAsset.id || evidence.sourceAsset.contentDigest !== input.sourceAsset.contentDigest || evidence.candidateAsset.id !== input.candidateAsset.id || evidence.candidateAsset.contentDigest !== input.candidateAsset.contentDigest) return { ok: false, code: "BLITZ_SIMILARITY_IDENTITY_MISMATCH" };
  const { digest: _digest, ...facts } = evidence;
  if (canonicalDigest(facts) !== evidence.digest || evidence.measurements.length !== BLITZ_SIMILARITY_MODALITIES.length || new Set(evidence.measurements.map((measurement) => measurement.modality)).size !== BLITZ_SIMILARITY_MODALITIES.length) return { ok: false, code: "BLITZ_SIMILARITY_EVIDENCE_INVALID" };
  if (evidence.status !== "passed" || evidence.measurements.some((measurement) => !measurement.passed || measurement.maximumBasisPoints !== THRESHOLD_BASIS_POINTS[measurement.modality] || !measurementPassed(measurement))) return { ok: false, code: "BLITZ_SIMILARITY_BLOCKED" };
  return { ok: true };
}
