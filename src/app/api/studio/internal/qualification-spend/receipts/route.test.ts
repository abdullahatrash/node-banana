import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ authorized: vi.fn(), importEvidence: vi.fn(), list: vi.fn(), authority: vi.fn() }));
vi.mock("@/lib/db", () => ({ isDatabaseConfigured: () => true, getDb: () => ({ mocked: true }) }));
vi.mock("@/lib/model-routing/qualification-webhook", () => ({ isQualificationHarnessAuthorized: (...args: unknown[]) => mocks.authorized(...args) }));
vi.mock("@/lib/model-routing/qualification-spend-evidence", () => ({
  importQualificationSpendEvidence: (...args: unknown[]) => mocks.importEvidence(...args),
  listPendingQualificationSpendEvidence: (...args: unknown[]) => mocks.list(...args),
  loadQualificationSpendSigningAuthority: (...args: unknown[]) => mocks.authority(...args),
}));

const receipt = {
  runId: "qualification-run-001",
  caseId: "arabic-case",
  predictionId: "prediction-1",
  amountUsd: 0.01,
  providerObservedAt: "2026-09-05T00:00:00.000Z",
  providerEvidenceKind: "replicate_account_usage_export",
  providerEvidenceDigest: `sha256:${"c".repeat(64)}`,
  importedBy: "operator@example.com",
  notes: "The account export row identifies this exact prediction and charge.",
  exactPredictionChargeConfirmed: true,
};

describe("qualification spend evidence receipt route", () => {
  beforeEach(() => {
    mocks.authorized.mockReset().mockReturnValue(true);
    mocks.authority.mockReset().mockReturnValue({ keyId: "spend-key" });
    mocks.importEvidence.mockReset().mockResolvedValue({ kind: "recorded", envelope: { receipt: { receiptId: "qsr_1" } } });
    mocks.list.mockReset().mockResolvedValue([{ predictionId: "prediction-1" }]);
  });

  it("lists predictions waiting for exact account evidence", async () => {
    const { GET } = await import("./route");
    const response = await GET(new NextRequest("http://localhost/api/studio/internal/qualification-spend/receipts?limit=10", { headers: { authorization: "Bearer harness" } }));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ success: true, items: [{ predictionId: "prediction-1" }] });
    expect(mocks.list).toHaveBeenCalledWith(expect.objectContaining({ limit: 10 }));
  });

  it("imports only an explicitly confirmed exact-prediction charge", async () => {
    const { POST } = await import("./route");
    const response = await POST(new NextRequest("http://localhost/api/studio/internal/qualification-spend/receipts", { method: "POST", headers: { authorization: "Bearer harness", "content-type": "application/json" }, body: JSON.stringify(receipt) }));
    expect(response.status).toBe(201);
    expect(mocks.importEvidence).toHaveBeenCalledWith(expect.objectContaining({
      predictionId: "prediction-1",
      providerEvidenceDigest: `sha256:${"c".repeat(64)}`,
      providerObservedAt: new Date("2026-09-05T00:00:00.000Z"),
    }));
  });

  it("rejects aggregate or ambiguous evidence without the exact-charge confirmation", async () => {
    const { POST } = await import("./route");
    const response = await POST(new NextRequest("http://localhost/api/studio/internal/qualification-spend/receipts", { method: "POST", headers: { authorization: "Bearer harness", "content-type": "application/json" }, body: JSON.stringify({ ...receipt, exactPredictionChargeConfirmed: false }) }));
    expect(response.status).toBe(400);
    expect(mocks.importEvidence).not.toHaveBeenCalled();
  });
});
