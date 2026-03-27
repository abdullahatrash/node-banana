/**
 * LinkedIn provider tests.
 *
 * All HTTP calls are mocked via vi.stubGlobal("fetch", ...) — no network
 * access required. Each test describes exactly which fetch responses it needs.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearRegistry } from "@/lib/social/provider-registry";

// ---------------------------------------------------------------------------
// Environment stubs — set before loading the module so env-reading code sees them
// ---------------------------------------------------------------------------

beforeEach(() => {
  clearRegistry();
  vi.stubEnv("LINKEDIN_CLIENT_ID", "test-client-id");
  vi.stubEnv("LINKEDIN_CLIENT_SECRET", "test-client-secret");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Sequence-based fetch mock: each call consumes the next response in the list. */
function mockFetchSequence(
  responses: Array<{ body?: Record<string, unknown>; status?: number; headers?: Record<string, string> }>,
) {
  let i = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn().mockImplementation(async () => {
      const entry = responses[i] ?? responses[responses.length - 1];
      i++;
      const { body = {}, status = 200, headers = {} } = entry;
      return {
        ok: status >= 200 && status < 300,
        status,
        headers: {
          get: (name: string) => headers[name.toLowerCase()] ?? null,
        },
        json: async () => body,
        text: async () => JSON.stringify(body),
        arrayBuffer: async () => Buffer.from("fake-image-bytes").buffer,
      };
    }),
  );
}

async function loadProvider() {
  // Fresh import so registerProvider() fires against a cleared registry
  vi.resetModules();
  const mod = await import("@/lib/social/providers/linkedin");
  return mod.linkedInProvider;
}

// ---------------------------------------------------------------------------
// generateAuthUrl
// ---------------------------------------------------------------------------

describe("linkedInProvider.generateAuthUrl", () => {
  it("returns a valid LinkedIn authorization URL", async () => {
    const provider = await loadProvider();
    const result = await provider.generateAuthUrl(
      "https://example.com/callback/linkedin",
    );

    expect(result.url).toContain(
      "https://www.linkedin.com/oauth/v2/authorization",
    );
    expect(result.url).toContain("client_id=test-client-id");
    expect(result.url).toContain(
      encodeURIComponent("https://example.com/callback/linkedin"),
    );
    expect(result.state).toBeTruthy();
    expect(result.state.length).toBeGreaterThanOrEqual(8);
  });

  it("includes all 7 required LinkedIn scopes", async () => {
    const provider = await loadProvider();
    const { url } = await provider.generateAuthUrl("https://example.com/cb");

    const expectedScopes = [
      "openid",
      "profile",
      "w_member_social",
      "r_basicprofile",
      "rw_organization_admin",
      "w_organization_social",
      "r_organization_social",
    ];

    for (const scope of expectedScopes) {
      expect(url).toContain(scope);
    }
  });

  it("generates a unique state on each call", async () => {
    const provider = await loadProvider();
    const a = await provider.generateAuthUrl("https://example.com/cb");
    const b = await provider.generateAuthUrl("https://example.com/cb");
    expect(a.state).not.toBe(b.state);
  });

  it("throws when LINKEDIN_CLIENT_ID is missing", async () => {
    vi.stubEnv("LINKEDIN_CLIENT_ID", "");
    vi.resetModules();
    const provider = await loadProvider();
    await expect(
      provider.generateAuthUrl("https://example.com/cb"),
    ).rejects.toThrow("LINKEDIN_CLIENT_ID");
  });
});

// ---------------------------------------------------------------------------
// authenticate
// ---------------------------------------------------------------------------

describe("linkedInProvider.authenticate", () => {
  it("exchanges code for tokens and fetches user profile", async () => {
    mockFetchSequence([
      // 1. Token exchange
      {
        body: {
          access_token: "access-123",
          refresh_token: "refresh-456",
          expires_in: 5184000,
        },
      },
      // 2. /v2/userinfo
      {
        body: {
          sub: "user-sub-001",
          name: "Jane Doe",
          picture: "https://example.com/avatar.jpg",
        },
      },
    ]);

    const provider = await loadProvider();
    const result = await provider.authenticate({
      code: "auth-code",
      state: "oauth-state",
      redirectUri: "https://example.com/callback/linkedin",
    });

    expect(result.platformUserId).toBe("user-sub-001");
    expect(result.accessToken).toBe("access-123");
    expect(result.refreshToken).toBe("refresh-456");
    expect(result.expiresIn).toBe(5184000);
    expect(result.displayName).toBe("Jane Doe");
    expect(result.avatarUrl).toBe("https://example.com/avatar.jpg");
    expect(result.requiresPageSelection).toBe(true);
  });

  it("throws when the token exchange returns an error", async () => {
    mockFetchSequence([
      {
        body: {
          error: "invalid_grant",
          error_description: "Authorization code expired",
        },
        status: 400,
      },
    ]);

    const provider = await loadProvider();
    await expect(
      provider.authenticate({
        code: "bad-code",
        state: "oauth-state",
        redirectUri: "https://example.com/cb",
      }),
    ).rejects.toThrow(/Authorization code expired/);
  });
});

// ---------------------------------------------------------------------------
// refreshToken
// ---------------------------------------------------------------------------

describe("linkedInProvider.refreshToken", () => {
  it("calls the token endpoint with grant_type=refresh_token", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        access_token: "new-access",
        refresh_token: "new-refresh",
        expires_in: 5184000,
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const provider = await loadProvider();
    const result = await provider.refreshToken("old-refresh-token");

    expect(result.accessToken).toBe("new-access");
    expect(result.refreshToken).toBe("new-refresh");
    expect(result.expiresIn).toBe(5184000);

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = new URLSearchParams(init.body as string);
    expect(body.get("grant_type")).toBe("refresh_token");
    expect(body.get("refresh_token")).toBe("old-refresh-token");
    expect(body.get("client_id")).toBe("test-client-id");
    expect(body.get("client_secret")).toBe("test-client-secret");
  });

  it("throws when the refresh response contains an error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 400,
        json: async () => ({
          error: "invalid_grant",
          error_description: "Refresh token expired",
        }),
      }),
    );

    const provider = await loadProvider();
    await expect(provider.refreshToken("expired-token")).rejects.toThrow(
      /Refresh token expired/,
    );
  });
});

// ---------------------------------------------------------------------------
// classifyError
// ---------------------------------------------------------------------------

describe("linkedInProvider.classifyError", () => {
  it("classifies 401 / Unauthorized as refresh-token", async () => {
    const provider = await loadProvider();
    const result = provider.classifyError(new Error("401 Unauthorized"));
    expect(result.type).toBe("refresh-token");
  });

  it("classifies token expired message as refresh-token", async () => {
    const provider = await loadProvider();
    const result = provider.classifyError(new Error("access token expired"));
    expect(result.type).toBe("refresh-token");
  });

  it("classifies 429 / Too Many Requests as retry", async () => {
    const provider = await loadProvider();
    const result = provider.classifyError(new Error("429 Too Many Requests"));
    expect(result.type).toBe("retry");
  });

  it("classifies INVALID_REQUEST as bad-body", async () => {
    const provider = await loadProvider();
    const result = provider.classifyError(
      new Error("INVALID_REQUEST: content violates policy"),
    );
    expect(result.type).toBe("bad-body");
  });

  it("classifies Unable to obtain activity as retry", async () => {
    const provider = await loadProvider();
    const result = provider.classifyError(
      new Error("Unable to obtain activity"),
    );
    expect(result.type).toBe("retry");
  });

  it("classifies unknown errors as retry", async () => {
    const provider = await loadProvider();
    const result = provider.classifyError(
      new Error("Something completely unexpected"),
    );
    expect(result.type).toBe("retry");
    expect(result.message).toContain("Something completely unexpected");
  });

  it("classifies non-Error objects", async () => {
    const provider = await loadProvider();
    const result = provider.classifyError({ code: 500, msg: "server error" });
    expect(result.type).toBe("retry");
  });

  it("preserves the original error in the result", async () => {
    const provider = await loadProvider();
    const original = new Error("boom");
    const result = provider.classifyError(original);
    expect(result.original).toBe(original);
  });
});

// ---------------------------------------------------------------------------
// post
// ---------------------------------------------------------------------------

describe("linkedInProvider.post", () => {
  it("posts text-only content without uploading media", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 201,
      headers: { get: () => "urn:li:share:987654321" },
      json: async () => ({}),
      text: async () => "",
    });
    vi.stubGlobal("fetch", fetchMock);

    const provider = await loadProvider();
    const results = await provider.post("person-001", "access-token", [
      { postId: "post-1", content: "Hello LinkedIn!" },
    ]);

    expect(results).toHaveLength(1);
    expect(results[0].postId).toBe("post-1");
    expect(results[0].platformPostId).toBe("urn:li:share:987654321");
    expect(results[0].platformPostUrl).toContain(
      encodeURIComponent("urn:li:share:987654321"),
    );
    expect(results[0].status).toBe("published");

    // Only 1 fetch call (the POST /rest/posts)
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("/rest/posts");
    const body = JSON.parse(init.body as string);
    expect(body.author).toBe("urn:li:person:person-001");
    expect(body.commentary).toContain("Hello LinkedIn");
    expect(body.lifecycleState).toBe("PUBLISHED");
  });

  it("uploads images before posting and includes them in the payload", async () => {
    let callIndex = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(async (url: string) => {
        callIndex++;
        // 1. initializeUpload for image
        if (url.includes("initializeUpload")) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              value: {
                uploadUrl: "https://linkedin-uploads.example.com/upload/img",
                image: "urn:li:image:abc123",
              },
            }),
          };
        }
        // 2. Fetch image from external URL
        if (url.includes("cdn.example.com")) {
          return {
            ok: true,
            status: 200,
            arrayBuffer: async () => Buffer.from("fake-jpeg-bytes").buffer,
          };
        }
        // 3. PUT binary upload
        if (url.includes("linkedin-uploads")) {
          return { ok: true, status: 200 };
        }
        // 4. POST /rest/posts
        if (url.includes("/rest/posts")) {
          return {
            ok: true,
            status: 201,
            headers: { get: () => "urn:li:share:111" },
            text: async () => "",
          };
        }
        return { ok: true, status: 200, json: async () => ({}) };
      }),
    );

    const provider = await loadProvider();
    const results = await provider.post("person-001", "access-token", [
      {
        postId: "post-img",
        content: "Check this out",
        media: [
          { type: "image", url: "https://cdn.example.com/photo.jpg" },
        ],
      },
    ]);

    expect(results[0].status).toBe("published");
    expect(results[0].platformPostId).toBe("urn:li:share:111");
  });

  it("returns empty array when requests array is empty", async () => {
    const provider = await loadProvider();
    const results = await provider.post("person-001", "access-token", []);
    expect(results).toHaveLength(0);
  });

  it("throws when LinkedIn returns a non-2xx status", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 422,
        headers: { get: () => null },
        text: async () => "Unprocessable Entity",
      }),
    );

    const provider = await loadProvider();
    await expect(
      provider.post("person-001", "access-token", [
        { postId: "post-fail", content: "Will fail" },
      ]),
    ).rejects.toThrow(/422/);
  });
});

// ---------------------------------------------------------------------------
// fetchPageInformation
// ---------------------------------------------------------------------------

describe("linkedInProvider.fetchPageInformation", () => {
  it("returns org pages the user administers", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          elements: [
            {
              "organization~": {
                id: 12345,
                localizedName: "Acme Corp",
                logoV2: {
                  "original~": {
                    elements: [
                      {
                        identifiers: [
                          { identifier: "https://example.com/logo.png" },
                        ],
                      },
                    ],
                  },
                },
              },
            },
          ],
        }),
      }),
    );

    const provider = await loadProvider();
    const pages = await provider.fetchPageInformation!("access-token");

    expect(pages).toHaveLength(1);
    expect(pages[0].id).toBe("12345");
    expect(pages[0].name).toBe("Acme Corp");
    expect(pages[0].picture).toBe("https://example.com/logo.png");
  });

  it("returns empty array when user has no admin orgs", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ elements: [] }),
      }),
    );

    const provider = await loadProvider();
    const pages = await provider.fetchPageInformation!("access-token");
    expect(pages).toHaveLength(0);
  });

  it("returns empty array on missing elements field", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ message: "No orgs found" }),
      }),
    );

    const provider = await loadProvider();
    const pages = await provider.fetchPageInformation!("access-token");
    expect(pages).toHaveLength(0);
  });

  it("filters out elements without an org id", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          elements: [
            { "organization~": { id: 99, localizedName: "Valid Org" } },
            { "organization~": { localizedName: "No ID Org" } }, // no id
            { noOrgTilde: true }, // missing organization~
          ],
        }),
      }),
    );

    const provider = await loadProvider();
    const pages = await provider.fetchPageInformation!("access-token");
    expect(pages).toHaveLength(1);
    expect(pages[0].id).toBe("99");
  });
});

// ---------------------------------------------------------------------------
// getCapabilities
// ---------------------------------------------------------------------------

describe("linkedInProvider.getCapabilities", () => {
  it("returns correct capabilities", async () => {
    const provider = await loadProvider();
    const caps = provider.getCapabilities();
    expect(caps.identifier).toBe("linkedin");
    expect(caps.displayName).toBe("LinkedIn");
    expect(caps.maxContentLength).toBe(3000);
    expect(caps.supportsImages).toBe(true);
    expect(caps.supportsVideo).toBe(false);
    expect(caps.supportsCarousel).toBe(true);
    expect(caps.requiresPageSelection).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Interface conformance
// ---------------------------------------------------------------------------

describe("linkedInProvider interface conformance", () => {
  it("has all required interface properties and methods", async () => {
    const provider = await loadProvider();
    expect(provider.identifier).toBe("linkedin");
    expect(provider.maxImages).toBe(9);
    expect(provider.maxConcurrentJobs).toBe(2);
    expect(provider.requiresPageSelection).toBe(true);
    expect(typeof provider.generateAuthUrl).toBe("function");
    expect(typeof provider.authenticate).toBe("function");
    expect(typeof provider.refreshToken).toBe("function");
    expect(typeof provider.post).toBe("function");
    expect(typeof provider.classifyError).toBe("function");
    expect(typeof provider.fetchPageInformation).toBe("function");
    expect(typeof provider.getCapabilities).toBe("function");
  });
});
