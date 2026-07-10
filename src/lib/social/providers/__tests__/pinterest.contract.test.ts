// @vitest-environment node

/**
 * Pinterest provider CONTRACT tests (MSW).
 *
 * Unlike `pinterest.test.ts` — which replaces `fetch` wholesale with
 * `vi.stubGlobal` — these tests exercise the provider's real `fetch()` calls
 * against a mocked Pinterest API v5 boundary via MSW.
 *
 * Scenario classes (the contract every provider must satisfy):
 *   1. successful post publish
 *   2. token-refresh trigger path        (401 → "refresh-token")
 *   3. rate-limit retry classification   (429 → "retry")
 *   4. permanent-failure classification  (400 board validation → "bad-body")
 *
 * Like LinkedIn/TikTok/Reddit, Pinterest's provider interpolates the real
 * `response.status` directly into the thrown Error's message
 * (`Pinterest pin creation failed: ${response.status} ${body}`), so
 * classifyError()'s status-code checks are genuinely reachable from a real
 * thrown error — no defect found for this provider.
 *
 * The provider code is intentionally UNMODIFIED.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { setupMswServer } from "@/test/msw/server";
import { clearRegistry } from "@/lib/social/provider-registry";
import { pinterestProvider } from "@/lib/social/providers/pinterest";
import type { PublishRequest } from "@/lib/social/provider-interface";

// ---------------------------------------------------------------------------
// Pinterest API v5 endpoints exercised by pinterestProvider.post()
// ---------------------------------------------------------------------------

const PINS_URL = "https://api.pinterest.com/v5/pins";

const imagePost: PublishRequest = {
  postId: "our-post-1",
  content: "Hello from a contract test",
  platformSettings: { boardId: "board-123" },
  media: [{ type: "image", url: "https://cdn.example.com/photo.jpg" }],
};

// ---------------------------------------------------------------------------
// MSW server — default handler describes the HAPPY PATH.
// ---------------------------------------------------------------------------

const server = setupMswServer(
  http.post(PINS_URL, () =>
    HttpResponse.json({
      id: "pin-123",
      link: "https://www.pinterest.com/pin/pin-123/",
    }),
  ),
);

beforeEach(() => {
  clearRegistry();
  process.env.PINTEREST_CLIENT_ID = "test-client-id";
  process.env.PINTEREST_CLIENT_SECRET = "test-client-secret";
});

afterEach(() => {
  delete process.env.PINTEREST_CLIENT_ID;
  delete process.env.PINTEREST_CLIENT_SECRET;
});

// ---------------------------------------------------------------------------
// Scenario 1 — successful post publish
// ---------------------------------------------------------------------------

describe("pinterestProvider contract — successful post publish", () => {
  it("creates a pin against the live Pinterest HTTP contract", async () => {
    const results = await pinterestProvider.post("user-1", "access-token", [
      imagePost,
    ]);

    expect(results).toHaveLength(1);
    expect(results[0]).toEqual({
      postId: "our-post-1",
      platformPostId: "pin-123",
      platformPostUrl: "https://www.pinterest.com/pin/pin-123/",
      status: "published",
    });
  });
});

/**
 * Helper: run a publish that the platform rejects, and return the *real*
 * error the provider threw.
 */
async function captureThrownError(): Promise<unknown> {
  return pinterestProvider.post("user-1", "access-token", [imagePost]).then(
    () => {
      throw new Error("expected post() to reject, but it resolved");
    },
    (err: unknown) => err,
  );
}

// ---------------------------------------------------------------------------
// Scenario 2 — token-refresh trigger path (HTTP 401)
// ---------------------------------------------------------------------------

describe("pinterestProvider contract — token-refresh trigger", () => {
  it("classifies a real 401 from /v5/pins as refresh-token", async () => {
    server.use(
      http.post(PINS_URL, () =>
        HttpResponse.json(
          { code: 32, message: "Invalid or expired access token" },
          { status: 401 },
        ),
      ),
    );

    const error = await captureThrownError();
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain("401");

    const classified = pinterestProvider.classifyError(error);
    expect(classified.type).toBe("refresh-token");
    expect(classified.original).toBe(error);
  });
});

// ---------------------------------------------------------------------------
// Scenario 3 — rate-limit retry classification (HTTP 429)
// ---------------------------------------------------------------------------

describe("pinterestProvider contract — rate-limit retry", () => {
  it("classifies a real 429 from /v5/pins as retry", async () => {
    server.use(
      http.post(PINS_URL, () =>
        HttpResponse.json(
          { code: 8, message: "Too many requests, please try again later." },
          { status: 429 },
        ),
      ),
    );

    const error = await captureThrownError();
    expect((error as Error).message).toContain("429");

    const classified = pinterestProvider.classifyError(error);
    expect(classified.type).toBe("retry");
  });
});

// ---------------------------------------------------------------------------
// Scenario 4 — permanent-failure classification (HTTP 400 board validation)
// ---------------------------------------------------------------------------

describe("pinterestProvider contract — permanent-failure", () => {
  it("classifies a real 400 board-validation rejection as bad-body", async () => {
    server.use(
      http.post(PINS_URL, () =>
        HttpResponse.json(
          { code: 2, message: "board_id: This board does not exist or you do not have access to it." },
          { status: 400 },
        ),
      ),
    );

    const error = await captureThrownError();
    expect((error as Error).message).toContain("400");

    const classified = pinterestProvider.classifyError(error);
    expect(classified.type).toBe("bad-body");
  });
});
