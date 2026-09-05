import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockIsDatabaseConfigured = vi.fn(() => true);
const mockRun = vi.fn();
const mockRetry = vi.fn();
const mockSkip = vi.fn();

vi.mock("@/lib/db", () => ({ isDatabaseConfigured: () => mockIsDatabaseConfigured() }));
vi.mock("@/lib/product-surfaces/licensed-trend-provider-inbox", () => ({
  LicensedTrendProviderInboxError: class LicensedTrendProviderInboxError extends Error {
    constructor(readonly code: string) { super(code); }
  },
  PRODUCTION_LICENSED_TREND_PROVIDER_INBOX: {
    run: (...args: unknown[]) => mockRun(...args),
    retry: (...args: unknown[]) => mockRetry(...args),
    skip: (...args: unknown[]) => mockSkip(...args),
  },
}));

function getRequest(url = "http://localhost:3000/api/studio/internal/licensed-trend-provider-events?limit=7") {
  return new NextRequest(url, { headers: { "x-studio-internal-secret": "secret_123", "x-vercel-id": "worker-1" } });
}

function postRequest(body: unknown) {
  return new NextRequest("http://localhost:3000/api/studio/internal/licensed-trend-provider-events", {
    method: "POST",
    headers: { "content-type": "application/json", "x-studio-internal-secret": "secret_123", "x-vercel-id": "worker-1" },
    body: JSON.stringify(body),
  });
}

describe("licensed trend provider event worker route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.STUDIO_INTERNAL_API_SECRET = "secret_123";
    mockIsDatabaseConfigured.mockReturnValue(true);
    mockRun.mockResolvedValue({ claimed: 0, succeeded: 0, retried: 0, failedKnown: 0, outcomeUnknown: 0 });
    mockRetry.mockResolvedValue({ state: "queued" });
    mockSkip.mockResolvedValue({ state: "skipped" });
  });

  it("runs a bounded worker only for an authenticated internal caller", async () => {
    const { GET } = await import("./route");
    const response = await GET(getRequest());
    expect(response.status).toBe(200);
    expect(mockRun).toHaveBeenCalledWith({ workerId: "worker-1", limit: 7 });
  });

  it("rejects unauthenticated worker calls", async () => {
    const { GET } = await import("./route");
    const response = await GET(new NextRequest("http://localhost:3000/api/studio/internal/licensed-trend-provider-events"));
    expect(response.status).toBe(401);
    expect(mockRun).not.toHaveBeenCalled();
  });

  it("supports explicit retry and reason-bound skip recovery", async () => {
    const { POST } = await import("./route");
    const retry = await POST(postRequest({ action: "retry", providerKey: "licensed.partner", eventId: "event-1" }));
    expect(retry.status).toBe(200);
    expect(mockRetry).toHaveBeenCalledWith({ action: "retry", providerKey: "licensed.partner", eventId: "event-1" });

    const skip = await POST(postRequest({ action: "skip", providerKey: "licensed.partner", eventId: "event-1", reason: "Contracted provider withdrew this package." }));
    expect(skip.status).toBe(200);
    expect(mockSkip).toHaveBeenCalledWith(expect.objectContaining({ reason: "Contracted provider withdrew this package." }));
  });

  it("rejects unreasoned skips", async () => {
    const { POST } = await import("./route");
    const response = await POST(postRequest({ action: "skip", providerKey: "licensed.partner", eventId: "event-1", reason: "no" }));
    expect(response.status).toBe(400);
    expect(mockSkip).not.toHaveBeenCalled();
  });
});
