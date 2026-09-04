import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ authorized: vi.fn(), observe: vi.fn() }));
vi.mock("@/lib/db", () => ({ isDatabaseConfigured: () => true, getDb: () => ({ mocked: true }) }));
vi.mock("@/lib/model-routing/qualification-webhook", () => ({
  isQualificationHarnessAuthorized: (...args: unknown[]) => mocks.authorized(...args),
  observeQualificationWebhook: (...args: unknown[]) => mocks.observe(...args),
}));

const base = "http://localhost/api/studio/internal/qualification-webhooks?caseId=arabic-complete&endpoint=official&model=prunaai%2Fp-video&version=prunaai%2Fp-video";

describe("qualification webhook observer route", () => {
  beforeEach(() => {
    mocks.authorized.mockReset().mockReturnValue(true);
    mocks.observe.mockReset();
  });

  it("does not disclose receipts without harness authorization", async () => {
    mocks.authorized.mockReturnValue(false);
    const { GET } = await import("./route");
    const response = await GET(new NextRequest(`${base}&predictionId=prediction-1`));
    expect(response.status).toBe(401);
    expect(mocks.observe).not.toHaveBeenCalled();
  });

  it("returns a recovered submission identity", async () => {
    mocks.observe.mockResolvedValue({ predictionId: "prediction-1", version: "prunaai/p-video" });
    const { GET } = await import("./route");
    const response = await GET(new NextRequest(`${base}&submissionKey=qualification%3Arun-12345678%3Aarabic-complete`, { headers: { authorization: "Bearer harness" } }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ predictionId: "prediction-1", version: "prunaai/p-video" });
    expect(mocks.observe).toHaveBeenCalledWith(expect.objectContaining({ caseId: "arabic-complete", endpoint: "official", model: "prunaai/p-video", submissionKey: "qualification:run-12345678:arabic-complete" }));
  });

  it("returns 404 while a terminal webhook has not arrived", async () => {
    mocks.observe.mockResolvedValue(null);
    const { GET } = await import("./route");
    const response = await GET(new NextRequest(`${base}&predictionId=prediction-1`, { headers: { authorization: "Bearer harness" } }));
    expect(response.status).toBe(404);
  });
});
