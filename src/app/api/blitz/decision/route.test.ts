import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({ decide: vi.fn() }));
vi.mock("@/lib/studio/withStudioAuth", () => ({ withStudioAuth: (_options: unknown, handler: (...args: unknown[]) => unknown) => (request: NextRequest) => handler(request, { workspaceId: "workspace-1", userId: "user-1" }) }));
vi.mock("@/lib/product-surfaces/blitz", () => ({ decideBlitzItem: (...args: unknown[]) => mocks.decide(...args) }));
vi.mock("@/lib/product-surfaces/repository", () => ({ ProductRecordConflictError: class extends Error {}, ProductRecordIdempotencyError: class extends Error {} }));
vi.mock("@/lib/product-surfaces/blitz-similarity-service", () => ({ BlitzSimilarityServiceError: class extends Error {} }));

import { POST } from "./route";

const accepted = { itemId: "blitz-1", expectedRevision: 1, decision: "accepted", reasons: [], generation: { assetId: "asset-1", intentId: "intent-1", operationId: "operation-1" }, similarityEvidenceId: null, idempotencyKey: "decision-key-1" };

function request(value: unknown) {
  return new NextRequest("http://localhost/api/blitz/decision", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(value) });
}

describe("Blitz decision route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.decide.mockResolvedValue({ itemId: "blitz-1", revision: 2, contentPieceId: "content-1" });
  });

  it("delegates acceptance without similarity so the item-bound source policy can decide", async () => {
    const response = await POST(request(accepted));

    expect(response.status).toBe(200);
    expect(mocks.decide).toHaveBeenCalledWith({ workspaceId: "workspace-1", userId: "user-1", ...accepted });
  });

  it("still rejects evidence-free rejection and acceptance carrying rejection reasons", async () => {
    const [emptyRejection, reasonedAcceptance] = await Promise.all([
      POST(request({ ...accepted, decision: "rejected", generation: null })),
      POST(request({ ...accepted, reasons: [{ code: "other", note: "No" }] })),
    ]);

    expect(emptyRejection.status).toBe(400);
    expect(reasonedAcceptance.status).toBe(400);
    expect(mocks.decide).not.toHaveBeenCalled();
  });
});
