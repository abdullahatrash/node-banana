import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ authorized: vi.fn(), authorize: vi.fn(), read: vi.fn(), authority: vi.fn() }));
vi.mock("@/lib/db", () => ({ isDatabaseConfigured: () => true, getDb: () => ({ mocked: true }) }));
vi.mock("@/lib/model-routing/qualification-webhook", () => ({ isQualificationHarnessAuthorized: (...args: unknown[]) => mocks.authorized(...args) }));
vi.mock("@/lib/model-routing/qualification-spend-evidence", () => ({
  authorizeQualificationSpend: (...args: unknown[]) => mocks.authorize(...args),
  readQualificationSpendEvidence: (...args: unknown[]) => mocks.read(...args),
  loadQualificationSpendSigningAuthority: (...args: unknown[]) => mocks.authority(...args),
}));

const authorization = {
  kind: "authorize_qualification_spend",
  runId: "qualification-run-001",
  caseId: "arabic-case",
  model: "owner/model",
  version: "immutable-version-001",
  capability: "text_to_image",
  billableQuantity: 1,
  maximumAmountUsd: 0.01,
  pricingSourceDigest: `sha256:${"a".repeat(64)}`,
  accountId: "replicate-account",
  credentialFingerprint: `sha256:${"b".repeat(64)}`,
};

describe("qualification spend service route", () => {
  beforeEach(() => {
    mocks.authorized.mockReset().mockReturnValue(true);
    mocks.authority.mockReset().mockReturnValue({ keyId: "spend-key" });
    mocks.authorize.mockReset().mockResolvedValue({ authorization: { authorizationId: "qsa_1" }, signature: { keyId: "spend-key" } });
    mocks.read.mockReset().mockResolvedValue(null);
  });

  it("creates a credential- and reviewed-price-bound authorization", async () => {
    const { POST } = await import("./route");
    const response = await POST(new NextRequest("http://localhost/api/studio/internal/qualification-spend", { method: "POST", headers: { authorization: "Bearer harness", "content-type": "application/json" }, body: JSON.stringify(authorization) }));
    expect(response.status).toBe(201);
    expect(mocks.authorize).toHaveBeenCalledWith(expect.objectContaining({
      runId: "qualification-run-001",
      pricingSourceDigest: `sha256:${"a".repeat(64)}`,
      account: expect.objectContaining({ accountId: "replicate-account", credentialFingerprint: `sha256:${"b".repeat(64)}` }),
      authority: { keyId: "spend-key" },
    }));
  });

  it("returns an imported receipt only for the exact prediction and case", async () => {
    mocks.read.mockResolvedValue({ receipt: { receiptId: "qsr_1" }, signature: { keyId: "spend-key" } });
    const { GET } = await import("./route");
    const response = await GET(new NextRequest("http://localhost/api/studio/internal/qualification-spend?predictionId=prediction-1&caseId=arabic-case", { headers: { authorization: "Bearer harness" } }));
    expect(response.status).toBe(200);
    expect(mocks.read).toHaveBeenCalledWith(expect.objectContaining({ predictionId: "prediction-1", caseId: "arabic-case" }));
  });

  it("rejects unauthenticated access before reading signing authority", async () => {
    mocks.authorized.mockReturnValue(false);
    const { POST } = await import("./route");
    const response = await POST(new NextRequest("http://localhost/api/studio/internal/qualification-spend", { method: "POST", body: JSON.stringify(authorization) }));
    expect(response.status).toBe(401);
    expect(mocks.authority).not.toHaveBeenCalled();
  });
});
