import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ authorized: vi.fn(), inspect: vi.fn(), record: vi.fn(), review: vi.fn(), read: vi.fn() }));
vi.mock("@/lib/db", () => ({ isDatabaseConfigured: () => true, getDb: () => ({ mocked: true }) }));
vi.mock("@/lib/model-routing/qualification-webhook", () => ({ isQualificationHarnessAuthorized: (...args: unknown[]) => mocks.authorized(...args) }));
vi.mock("@/lib/model-routing/qualification-artifact-review", () => ({
  inspectQualificationArtifact: (...args: unknown[]) => mocks.inspect(...args),
  recordQualificationArtifactInspection: (...args: unknown[]) => mocks.record(...args),
  recordQualificationArtifactReview: (...args: unknown[]) => mocks.review(...args),
  readQualificationIngestionReceipt: (...args: unknown[]) => mocks.read(...args),
}));

const body = { predictionId: "prediction-1", caseId: "arabic-case", capability: "text_to_image", contentLanguage: "ar", output: "https://replicate.delivery/output.png" };

describe("qualification artifact route", () => {
  beforeEach(() => {
    mocks.authorized.mockReset().mockReturnValue(true);
    mocks.inspect.mockReset().mockResolvedValue({ inspection: { receiptId: "qai_123", contentDigest: `sha256:${"a".repeat(64)}` }, automaticallyObservedLanguages: null });
    mocks.record.mockReset().mockResolvedValue({ kind: "recorded" });
    mocks.review.mockReset();
    mocks.read.mockReset().mockResolvedValue({ state: "pending", receiptId: "qai_123", contentDigest: `sha256:${"a".repeat(64)}`, kind: "media" });
  });

  it("records technical evidence and returns a manual-review state for media", async () => {
    const { POST } = await import("./route");
    const response = await POST(new NextRequest("http://localhost/api/studio/internal/qualification-artifacts", { method: "POST", headers: { authorization: "Bearer harness", "content-type": "application/json" }, body: JSON.stringify(body) }));
    expect(response.status).toBe(202);
    expect(mocks.inspect).toHaveBeenCalledWith(expect.objectContaining({ contentLanguage: "ar", capability: "text_to_image" }));
    expect(mocks.record).toHaveBeenCalledOnce();
    expect(mocks.review).not.toHaveBeenCalled();
  });

  it("automatically binds deterministic text-script evidence", async () => {
    mocks.inspect.mockResolvedValue({ inspection: { receiptId: "qai_text", contentDigest: `sha256:${"a".repeat(64)}` }, automaticallyObservedLanguages: ["ar", "en"] });
    mocks.read.mockResolvedValue({ state: "accepted", receipt: { kind: "text", receiptId: "qai_text", contentDigest: `sha256:${"a".repeat(64)}`, characterCount: 20, observedLanguages: ["ar", "en"], languageEvidenceDigest: `sha256:${"b".repeat(64)}` } });
    const { POST } = await import("./route");
    const response = await POST(new NextRequest("http://localhost/api/studio/internal/qualification-artifacts", { method: "POST", headers: { authorization: "Bearer harness", "content-type": "application/json" }, body: JSON.stringify({ ...body, capability: "text_generation", output: "مرحبا Brand" }) }));
    expect(response.status).toBe(200);
    expect(mocks.review).toHaveBeenCalledWith(expect.objectContaining({ decision: "accepted", method: "automatic_unicode_script", observedLanguages: ["ar", "en"] }));
  });

  it("rejects unauthenticated inspection before processing output", async () => {
    mocks.authorized.mockReturnValue(false);
    const { POST } = await import("./route");
    const response = await POST(new NextRequest("http://localhost/api/studio/internal/qualification-artifacts", { method: "POST", body: "secret output" }));
    expect(response.status).toBe(401);
    expect(mocks.inspect).not.toHaveBeenCalled();
  });
});
