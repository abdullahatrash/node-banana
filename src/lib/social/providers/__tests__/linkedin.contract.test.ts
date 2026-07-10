// @vitest-environment node

/**
 * LinkedIn provider CONTRACT tests (MSW).
 *
 * Unlike `linkedin.test.ts` — which replaces `fetch` wholesale with
 * `vi.stubGlobal` — these tests exercise the provider's real `fetch()` calls
 * against a mocked LinkedIn REST API boundary via MSW, so URL construction,
 * headers, and the real thrown-error shape are all exercised.
 *
 * Scenario classes (the contract every provider must satisfy):
 *   1. successful post publish
 *   2. token-refresh trigger path        (401 → "refresh-token")
 *   3. rate-limit retry classification   (429 → "retry")
 *   4. permanent-failure classification  (400 → "bad-body")
 *
 * The provider code is intentionally UNMODIFIED.
 *
 * Note: LinkedIn's classifyError() builds its match string directly from
 * `error.message`, and the provider's own thrown Error interpolates the real
 * HTTP status code into that message (e.g. `LinkedIn post creation failed:
 * ${postResp.status} — ...`). That means, unlike the Meta-family providers
 * (see facebook/instagram/threads contract files), the status-code-driven
 * branches here are genuinely reachable from a real thrown error — no defect
 * found for this provider.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { setupMswServer } from "@/test/msw/server";
import { clearRegistry } from "@/lib/social/provider-registry";
import { linkedInProvider } from "@/lib/social/providers/linkedin";
import type { PublishRequest } from "@/lib/social/provider-interface";

// ---------------------------------------------------------------------------
// LinkedIn REST API endpoints exercised by linkedInProvider.post()
// ---------------------------------------------------------------------------

const POSTS_URL = "https://api.linkedin.com/rest/posts";

const textPost: PublishRequest = {
  postId: "our-post-1",
  content: "Hello from a contract test",
};

// ---------------------------------------------------------------------------
// MSW server — default handler describes the HAPPY PATH.
// ---------------------------------------------------------------------------

const server = setupMswServer(
  http.post(POSTS_URL, () =>
    HttpResponse.json(
      {},
      { status: 201, headers: { "x-restli-id": "urn:li:share:7000000000001" } },
    ),
  ),
);

beforeEach(() => {
  clearRegistry();
  process.env.LINKEDIN_CLIENT_ID = "test-client-id";
  process.env.LINKEDIN_CLIENT_SECRET = "test-client-secret";
});

afterEach(() => {
  delete process.env.LINKEDIN_CLIENT_ID;
  delete process.env.LINKEDIN_CLIENT_SECRET;
});

// ---------------------------------------------------------------------------
// Scenario 1 — successful post publish
// ---------------------------------------------------------------------------

describe("linkedInProvider contract — successful post publish", () => {
  it("publishes a text-only post against the live LinkedIn HTTP contract", async () => {
    const results = await linkedInProvider.post("person-001", "access-token", [
      textPost,
    ]);

    expect(results).toHaveLength(1);
    expect(results[0]).toEqual({
      postId: "our-post-1",
      platformPostId: "urn:li:share:7000000000001",
      platformPostUrl:
        "https://www.linkedin.com/feed/update/" +
        encodeURIComponent("urn:li:share:7000000000001"),
      status: "published",
    });
  });
});

/**
 * Helper: run a publish that the platform rejects, and return the *real*
 * error the provider threw (built from a real fetch Response, not a
 * synthetic string).
 */
async function captureThrownError(): Promise<unknown> {
  return linkedInProvider.post("person-001", "access-token", [textPost]).then(
    () => {
      throw new Error("expected post() to reject, but it resolved");
    },
    (err: unknown) => err,
  );
}

// ---------------------------------------------------------------------------
// Scenario 2 — token-refresh trigger path (HTTP 401)
// ---------------------------------------------------------------------------

describe("linkedInProvider contract — token-refresh trigger", () => {
  it("classifies a real 401 from /rest/posts as refresh-token", async () => {
    server.use(
      http.post(POSTS_URL, () =>
        HttpResponse.text("Invalid access token", { status: 401 }),
      ),
    );

    const error = await captureThrownError();
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain("401");

    const classified = linkedInProvider.classifyError(error);
    expect(classified.type).toBe("refresh-token");
    expect(classified.original).toBe(error);
  });
});

// ---------------------------------------------------------------------------
// Scenario 3 — rate-limit retry classification (HTTP 429)
// ---------------------------------------------------------------------------

describe("linkedInProvider contract — rate-limit retry", () => {
  it("classifies a real 429 from /rest/posts as retry", async () => {
    server.use(
      http.post(POSTS_URL, () =>
        HttpResponse.text("Too many requests", { status: 429 }),
      ),
    );

    const error = await captureThrownError();
    expect((error as Error).message).toContain("429");

    const classified = linkedInProvider.classifyError(error);
    expect(classified.type).toBe("retry");
    expect(classified.message).toBe("LinkedIn rate limit reached. Will retry shortly.");
  });
});

// ---------------------------------------------------------------------------
// Scenario 4 — permanent-failure classification (HTTP 400)
// ---------------------------------------------------------------------------

describe("linkedInProvider contract — permanent-failure", () => {
  it("classifies a real 400 content rejection from /rest/posts as bad-body", async () => {
    server.use(
      http.post(POSTS_URL, () =>
        HttpResponse.text(
          JSON.stringify({
            message: "commentary field exceeds the maximum allowed length",
            status: 400,
          }),
          { status: 400 },
        ),
      ),
    );

    const error = await captureThrownError();
    expect((error as Error).message).toContain("400");

    const classified = linkedInProvider.classifyError(error);
    expect(classified.type).toBe("bad-body");
  });
});
