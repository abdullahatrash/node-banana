import { canonicalDigest } from "@/lib/agent-tools/canonical";

export const BLITZ_SIMILARITY_MODALITIES = ["text", "frame", "audio"] as const;
export type BlitzSimilarityModality = (typeof BLITZ_SIMILARITY_MODALITIES)[number];
export type BlitzSimilarityMediaType = "image" | "video" | "audio";
export type BlitzSimilarityCoverage = "compared" | "not_applicable" | "source_absent" | "candidate_absent" | "both_absent";

const THRESHOLD_BASIS_POINTS: Record<BlitzSimilarityModality, number> = {
  text: 6_500,
  frame: 8_200,
  audio: 7_500,
};

const MEDIA_MODALITIES: Record<BlitzSimilarityMediaType, readonly BlitzSimilarityModality[]> = {
  image: ["frame"],
  video: ["text", "frame", "audio"],
  audio: ["audio"],
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
  sourceAsset: { id: string; contentDigest: `sha256:${string}`; mediaType: BlitzSimilarityMediaType };
  candidateAsset: { id: string; contentDigest: `sha256:${string}`; mediaType: BlitzSimilarityMediaType };
  measurements: Array<BlitzSimilarityMeasurementInput & { required: boolean; maximumBasisPoints: number; passed: boolean }>;
  status: "passed" | "blocked";
  evaluatedAt: string;
  evaluator: { kind: "qualified_internal"; adapterId: string; adapterVersion: string; qualificationDigest: `sha256:${string}` };
  digest: `sha256:${string}`;
}

function modalityRequired(input: {
  sourceMediaType: BlitzSimilarityMediaType;
  candidateMediaType: BlitzSimilarityMediaType;
  modality: BlitzSimilarityModality;
}): boolean {
  return MEDIA_MODALITIES[input.sourceMediaType].includes(input.modality)
    && MEDIA_MODALITIES[input.candidateMediaType].includes(input.modality);
}

function measurementPassed(measurement: BlitzSimilarityMeasurementInput, required: boolean): boolean {
  if (!required) {
    return measurement.coverage === "not_applicable"
      && measurement.similarityBasisPoints === null
      && measurement.sourceFingerprintDigest === null
      && measurement.candidateFingerprintDigest === null;
  }
  if (measurement.coverage !== "compared") return false;
  return measurement.similarityBasisPoints !== null
    && measurement.sourceFingerprintDigest !== null
    && measurement.candidateFingerprintDigest !== null
    && Number.isInteger(measurement.similarityBasisPoints)
    && measurement.similarityBasisPoints >= 0
    && measurement.similarityBasisPoints <= THRESHOLD_BASIS_POINTS[measurement.modality];
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
    const required = modalityRequired({ sourceMediaType: input.sourceAsset.mediaType, candidateMediaType: input.candidateAsset.mediaType, modality });
    return { ...measurement, required, maximumBasisPoints: THRESHOLD_BASIS_POINTS[modality], passed: measurementPassed(measurement, required) };
  });
  const facts = {
    schema: "blitz-similarity-gate/v1" as const,
    policyVersion: "blitz-similarity-policy/2026-09-04" as const,
    sourceAsset: input.sourceAsset,
    candidateAsset: input.candidateAsset,
    measurements,
    status: measurements.some((measurement) => measurement.required) && measurements.every((measurement) => measurement.passed) ? "passed" as const : "blocked" as const,
    evaluatedAt: input.evaluatedAt.toISOString(),
    evaluator: input.evaluator,
  };
  return { ...facts, digest: canonicalDigest(facts) as `sha256:${string}` };
}

export function validateBlitzSimilarityGate(input: {
  evidence: BlitzSimilarityGateEvidence | null;
  sourceAsset: BlitzSimilarityGateEvidence["sourceAsset"];
  candidateAsset: BlitzSimilarityGateEvidence["candidateAsset"];
}): { ok: true } | { ok: false; code: "BLITZ_SIMILARITY_REQUIRED" | "BLITZ_SIMILARITY_IDENTITY_MISMATCH" | "BLITZ_SIMILARITY_EVIDENCE_INVALID" | "BLITZ_SIMILARITY_BLOCKED" } {
  const { evidence } = input;
  if (!evidence) return { ok: false, code: "BLITZ_SIMILARITY_REQUIRED" };
  if (evidence.sourceAsset.id !== input.sourceAsset.id || evidence.sourceAsset.contentDigest !== input.sourceAsset.contentDigest || evidence.sourceAsset.mediaType !== input.sourceAsset.mediaType || evidence.candidateAsset.id !== input.candidateAsset.id || evidence.candidateAsset.contentDigest !== input.candidateAsset.contentDigest || evidence.candidateAsset.mediaType !== input.candidateAsset.mediaType) return { ok: false, code: "BLITZ_SIMILARITY_IDENTITY_MISMATCH" };
  const { digest: _digest, ...facts } = evidence;
  if (canonicalDigest(facts) !== evidence.digest || evidence.measurements.length !== BLITZ_SIMILARITY_MODALITIES.length || new Set(evidence.measurements.map((measurement) => measurement.modality)).size !== BLITZ_SIMILARITY_MODALITIES.length) return { ok: false, code: "BLITZ_SIMILARITY_EVIDENCE_INVALID" };
  const requiredModalities = new Set(BLITZ_SIMILARITY_MODALITIES.filter((modality) => modalityRequired({ sourceMediaType: input.sourceAsset.mediaType, candidateMediaType: input.candidateAsset.mediaType, modality })));
  if (evidence.status !== "passed" || requiredModalities.size === 0 || evidence.measurements.some((measurement) => measurement.required !== requiredModalities.has(measurement.modality) || !measurement.passed || measurement.maximumBasisPoints !== THRESHOLD_BASIS_POINTS[measurement.modality] || !measurementPassed(measurement, measurement.required))) return { ok: false, code: "BLITZ_SIMILARITY_BLOCKED" };
  return { ok: true };
}
