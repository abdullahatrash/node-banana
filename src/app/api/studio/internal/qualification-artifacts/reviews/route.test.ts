import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ authorized: vi.fn(), list: vi.fn(), review: vi.fn() }));
vi.mock("@/lib/db", () => ({ isDatabaseConfigured: () => true, getDb: () => ({ mocked: true }) }));
vi.mock("@/lib/model-routing/qualification-webhook", () => ({ isQualificationHarnessAuthorized: (...args: unknown[]) => mocks.authorized(...args) }));
vi.mock("@/lib/model-routing/qualification-artifact-review", () => ({
  listPendingQualificationArtifactInspections: (...args: unknown[]) => mocks.list(...args),
  recordQualificationArtifactReview: (...args: unknown[]) => mocks.review(...args),
}));

describe("qualification artifact review route", () => {
  beforeEach(() => {
    mocks.authorized.mockReset().mockReturnValue(true);
    mocks.list.mockReset().mockResolvedValue([{ receiptId: "qai_123", requiredMethod: "operator_visual_review" }]);
    mocks.review.mockReset().mockResolvedValue({ kind: "recorded", languageEvidenceDigest: `sha256:${"b".repeat(64)}` });
  });

  it("lists pending reviews without provider output URLs", async () => {
    const { GET } = await import("./route");
    const response = await GET(new NextRequest("http://localhost/api/studio/internal/qualification-artifacts/reviews", { headers: { authorization: "Bearer harness" } }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ items: [{ receiptId: "qai_123", requiredMethod: "operator_visual_review" }] });
  });

  it("records a digest-bound operator review", async () => {
    const { POST } = await import("./route");
    const response = await POST(new NextRequest("http://localhost/api/studio/internal/qualification-artifacts/reviews", { method: "POST", headers: { authorization: "Bearer harness", "content-type": "application/json" }, body: JSON.stringify({ receiptId: `qai_${"1".repeat(32)}`, reviewedContentDigest: `sha256:${"a".repeat(64)}`, decision: "accepted", reviewerId: "operator@example.com", method: "operator_visual_review", observedLanguages: ["ar"], notes: "Arabic composition and legibility verified." }) }));
    expect(response.status).toBe(201);
    expect(mocks.review).toHaveBeenCalledWith(expect.objectContaining({ decision: "accepted", observedLanguages: ["ar"], reviewerId: "operator@example.com" }));
  });

  it("rejects malformed reviews before writing immutable evidence", async () => {
    const { POST } = await import("./route");
    const response = await POST(new NextRequest("http://localhost/api/studio/internal/qualification-artifacts/reviews", { method: "POST", headers: { authorization: "Bearer harness", "content-type": "application/json" }, body: "{}" }));
    expect(response.status).toBe(400);
    expect(mocks.review).not.toHaveBeenCalled();
  });
});
