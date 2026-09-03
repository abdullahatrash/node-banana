import { describe, expect, it, vi } from "vitest";
import { ArtifactIngestionBusyError, S3CanonicalArtifactIngestion, validateDecodedArtifact } from "../artifact-ingestion";
import type { ArtifactReceiptPort } from "../artifact-receipts";
import type { GenerationIntent } from "../types";
import { testOutputContract, testRef, TEST_REGION_ADMISSION, TEST_RIGHTS } from "./fixtures";

const intent: GenerationIntent = {
  schema: "generation-intent/v1", id: "intent-artifact", workspaceId: "ws",
  brand: { profileId: "brand", revision: 4, digest: `sha256:${"a".repeat(64)}`, acceptedAt: new Date("2026-09-03T00:00:00Z") },
  promptDigest: `sha256:${"b".repeat(64)}`, capability: "text_to_video", contentLanguage: "ar", arabicVariety: "gulf",
  rights: TEST_RIGHTS, remixBrief: { digest: `sha256:${"e".repeat(64)}`, preserve: [], transform: [], avoid: [] }, regionAdmission: TEST_REGION_ADMISSION,
  outputContract: testOutputContract(5, 8), requestedModel: testRef(5), selectedModel: testRef(5), fallbackAuthorizationId: null,
  quote: { currency: "USD", amount: 0.4, basis: "second", quantity: 8, quotedAt: new Date("2026-09-03T00:00:00Z"), expiresAt: new Date("2026-09-03T00:05:00Z") },
  reservationIds: ["reservation"], createdByUserId: "user", createdAt: new Date("2026-09-03T00:00:00Z"),
};

describe("canonical artifact ingestion", () => {
  it("validates decoded 9:16 video dimensions, duration, and fps", () => {
    expect(() => validateDecodedArtifact(intent.outputContract, { width: 1080, height: 1920, durationSeconds: 8, fps: 30 })).not.toThrow();
    expect(() => validateDecodedArtifact(intent.outputContract, { width: 1920, height: 1080, durationSeconds: 8, fps: 30 })).toThrow("ARTIFACT_DIMENSIONS_MISMATCH");
    expect(() => validateDecodedArtifact(intent.outputContract, { width: 1080, height: 1920, durationSeconds: 7, fps: 30 })).toThrow("ARTIFACT_VIDEO_CONTRACT_MISMATCH");
    expect(() => validateDecodedArtifact(intent.outputContract, { width: 1080, height: 1920, durationSeconds: 8, fps: 24 })).toThrow("ARTIFACT_VIDEO_CONTRACT_MISMATCH");
  });

  it("replays a completed prediction/output receipt without network or duplicate asset work", async () => {
    const fetcher = vi.fn(() => { throw new Error("network must not run on replay"); });
    const receipts = { claim: vi.fn(async () => ({ kind: "ready" as const, receipt: { assetId: "asset-existing" } })), complete: vi.fn() } as unknown as ArtifactReceiptPort;
    const ingestion = new S3CanonicalArtifactIngestion(fetcher as unknown as typeof fetch, ["replicate.delivery"], receipts);
    await expect(ingestion.ingest({ workspaceId: "ws", intent, providerPredictionId: "prediction-1", output: ["https://replicate.delivery/output.mp4"] })).resolves.toEqual({ artifactIds: ["asset-existing"] });
    expect(fetcher).not.toHaveBeenCalled();
    expect(receipts.complete).not.toHaveBeenCalled();
  });

  it("never races a currently leased output receipt", async () => {
    const fetcher = vi.fn();
    const receipts = { claim: vi.fn(async () => ({ kind: "busy" as const })), complete: vi.fn() } as unknown as ArtifactReceiptPort;
    const ingestion = new S3CanonicalArtifactIngestion(fetcher as unknown as typeof fetch, ["replicate.delivery"], receipts);
    await expect(ingestion.ingest({ workspaceId: "ws", intent, providerPredictionId: "prediction-1", output: ["https://replicate.delivery/output.mp4"] })).rejects.toBeInstanceOf(ArtifactIngestionBusyError);
    expect(fetcher).not.toHaveBeenCalled();
  });
});
