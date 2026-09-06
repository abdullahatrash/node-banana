import { beforeEach, describe, expect, it, vi } from "vitest";
import { productRequest } from "../ProductApi";

describe("productRequest", () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.localStorage.setItem("node-banana-active-workspace-id", "workspace-1");
    vi.unstubAllGlobals();
  });

  it("retains bounded machine codes for localized presentation", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ success: false, code: "CONTENT_REVISION_CONFLICT", managedCreditQuote: { quoteId: "quote-1" } }), { status: 409 })));

    await expect(productRequest("/api/product-content", {})).rejects.toMatchObject({
      name: "ProductRequestError",
      code: "CONTENT_REVISION_CONFLICT",
      details: { managedCreditQuote: { quoteId: "quote-1" } },
    });
  });

  it("does not expose arbitrary server error prose to product surfaces", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ success: false, error: "Internal provider token was rejected" }), { status: 500 })));

    await expect(productRequest("/api/product-content", {})).rejects.toMatchObject({
      name: "ProductRequestError",
      code: "REQUEST_FAILED",
      message: "REQUEST_FAILED",
    });
  });
});
