import { describe, expect, it } from "vitest";
import { buildBlitzSimilarityGate, validateBlitzSimilarityGate, type BlitzSimilarityMeasurementInput } from "../blitz-similarity-policy";

const digest = (character: string) => `sha256:${character.repeat(64)}` as const;
const sourceAsset = { id: "source", contentDigest: digest("a") };
const candidateAsset = { id: "candidate", contentDigest: digest("b") };
const measurements: BlitzSimilarityMeasurementInput[] = [
  { modality: "text", algorithm: "minhash", algorithmVersion: "1", coverage: "compared", similarityBasisPoints: 2_000, sourceFingerprintDigest: digest("c"), candidateFingerprintDigest: digest("d") },
  { modality: "frame", algorithm: "phash-sequence", algorithmVersion: "1", coverage: "compared", similarityBasisPoints: 5_000, sourceFingerprintDigest: digest("e"), candidateFingerprintDigest: digest("f") },
  { modality: "audio", algorithm: "chromaprint", algorithmVersion: "1", coverage: "compared", similarityBasisPoints: 3_000, sourceFingerprintDigest: digest("1"), candidateFingerprintDigest: digest("2") },
];

describe("Blitz similarity gate", () => {
  it("requires pinned text, frame, and audio measurements", () => {
    expect(() => buildBlitzSimilarityGate({ sourceAsset, candidateAsset, measurements: measurements.slice(0, 2), evaluatedAt: new Date(), evaluator: { kind: "qualified_internal", adapterId: "similarity", adapterVersion: "1", qualificationDigest: digest("9") } })).toThrow("BLITZ_SIMILARITY_COVERAGE_INCOMPLETE");
  });

  it("pins a passing evidence digest to exact source and candidate bytes", () => {
    const evidence = buildBlitzSimilarityGate({ sourceAsset, candidateAsset, measurements, evaluatedAt: new Date("2026-09-04T00:00:00Z"), evaluator: { kind: "qualified_internal", adapterId: "similarity", adapterVersion: "1", qualificationDigest: digest("9") } });
    expect(evidence.status).toBe("passed");
    expect(validateBlitzSimilarityGate({ evidence, sourceAsset, candidateAsset })).toEqual({ ok: true });
    expect(validateBlitzSimilarityGate({ evidence, sourceAsset, candidateAsset: { ...candidateAsset, contentDigest: digest("9") } })).toMatchObject({ ok: false, code: "BLITZ_SIMILARITY_IDENTITY_MISMATCH" });
  });

  it("blocks a candidate exceeding any fixed policy threshold", () => {
    const evidence = buildBlitzSimilarityGate({ sourceAsset, candidateAsset, measurements: measurements.map((measurement) => measurement.modality === "audio" ? { ...measurement, coverage: "compared", similarityBasisPoints: 9_000, sourceFingerprintDigest: digest("7"), candidateFingerprintDigest: digest("8") } : measurement), evaluatedAt: new Date(), evaluator: { kind: "qualified_internal", adapterId: "similarity", adapterVersion: "1", qualificationDigest: digest("9") } });
    expect(evidence.status).toBe("blocked");
    expect(validateBlitzSimilarityGate({ evidence, sourceAsset, candidateAsset })).toMatchObject({ ok: false, code: "BLITZ_SIMILARITY_BLOCKED" });
  });

  it.each([
    ["text", "source_absent"],
    ["frame", "candidate_absent"],
    ["audio", "both_absent"],
  ] as const)("fails closed when required %s evidence has %s coverage", (modality, coverage) => {
    const evidence = buildBlitzSimilarityGate({
      sourceAsset,
      candidateAsset,
      measurements: measurements.map((measurement) => measurement.modality === modality
        ? {
            ...measurement,
            coverage,
            similarityBasisPoints: null,
            sourceFingerprintDigest: coverage === "candidate_absent" ? measurement.sourceFingerprintDigest : null,
            candidateFingerprintDigest: coverage === "source_absent" ? measurement.candidateFingerprintDigest : null,
          }
        : measurement),
      evaluatedAt: new Date(),
      evaluator: { kind: "qualified_internal", adapterId: "similarity", adapterVersion: "1", qualificationDigest: digest("9") },
    });

    expect(evidence.measurements.find((measurement) => measurement.modality === modality)).toMatchObject({ coverage, passed: false });
    expect(evidence.status).toBe("blocked");
    expect(validateBlitzSimilarityGate({ evidence, sourceAsset, candidateAsset })).toMatchObject({ ok: false, code: "BLITZ_SIMILARITY_BLOCKED" });
  });

  it("rejects tampered scores even when the status string remains passed", () => {
    const evidence = buildBlitzSimilarityGate({ sourceAsset, candidateAsset, measurements, evaluatedAt: new Date(), evaluator: { kind: "qualified_internal", adapterId: "similarity", adapterVersion: "1", qualificationDigest: digest("9") } });
    const tampered = structuredClone(evidence); tampered.measurements[0]!.similarityBasisPoints = 0;
    expect(validateBlitzSimilarityGate({ evidence: tampered, sourceAsset, candidateAsset })).toMatchObject({ ok: false, code: "BLITZ_SIMILARITY_EVIDENCE_INVALID" });
  });
});
