import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({ capture: vi.fn() }));
vi.mock("@/lib/db", () => ({ isDatabaseConfigured: () => true }));
vi.mock("@/lib/commercial/production", () => ({ COMMERCIAL: { captureReferralVisit: mocks.capture } }));
vi.mock("@/lib/site-routing", () => ({ getPublicAppUrl: (path: string) => `https://app.example.com${path}` }));

import { GET } from "./route";

describe("GET /r/[code]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.capture.mockResolvedValue({ token: "a".repeat(43) });
  });

  it("records the visit, sets an opaque HttpOnly cookie, and redirects to app signup", async () => {
    const response = await GET(
      new NextRequest("https://app.example.com/r/abc-123"),
      { params: Promise.resolve({ code: "abc-123" }) },
    );
    expect(mocks.capture).toHaveBeenCalledWith({ code: "abc-123", existingToken: null });
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("https://app.example.com/sign-up?referral=captured");
    expect(response.headers.get("set-cookie")).toContain("node-banana-referral-capture=");
    expect(response.headers.get("set-cookie")).toContain("HttpOnly");
    expect(response.headers.get("set-cookie")).toContain("SameSite=lax");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
  });

  it("reuses the opaque token so repository policy can preserve first touch", async () => {
    const token = "b".repeat(43);
    await GET(
      new NextRequest("https://app.example.com/r/SECOND", { headers: { cookie: `node-banana-referral-capture=${token}` } }),
      { params: Promise.resolve({ code: "SECOND" }) },
    );
    expect(mocks.capture).toHaveBeenCalledWith({ code: "SECOND", existingToken: token });
  });
});
