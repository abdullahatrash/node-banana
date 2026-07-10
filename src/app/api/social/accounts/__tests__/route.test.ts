import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";

const mockWithApiPermission = vi.fn();
const mockListSocialAccounts = vi.fn();
const mockGetSocialAccount = vi.fn();
const mockDisconnectSocialAccount = vi.fn();
const mockUpdateSocialAccount = vi.fn();
const mockCountSocialPostsForAccount = vi.fn();
const mockCreateOAuthState = vi.fn();
const mockConsumeOAuthState = vi.fn();
const mockGetOAuthStateByState = vi.fn();
const mockCreateOAuthSelectionSession = vi.fn();
const mockConsumeOAuthSelectionSession = vi.fn();
const mockGetOAuthSelectionSession = vi.fn();
const mockCountActiveSocialAccounts = vi.fn();
const mockUpsertSocialAccount = vi.fn();
const mockGetProvider = vi.fn();
const mockIsProviderRegistered = vi.fn();
const mockIsPlatformConfigured = vi.fn();
const mockEncryptToken = vi.fn();
const mockDecryptToken = vi.fn();

vi.mock("@/lib/db", () => ({
  isDatabaseConfigured: vi.fn(() => true),
}));

vi.mock("@/lib/studio/authz", () => ({
  withApiPermission: (...args: unknown[]) => mockWithApiPermission(...args),
  authzErrorResponse: (result: { status: number; error: string }) =>
    NextResponse.json({ success: false, error: result.error }, { status: result.status }),
}));

vi.mock("@/lib/social/repository", () => ({
  listSocialAccounts: (...args: unknown[]) => mockListSocialAccounts(...args),
  getSocialAccount: (...args: unknown[]) => mockGetSocialAccount(...args),
  disconnectSocialAccount: (...args: unknown[]) => mockDisconnectSocialAccount(...args),
  updateSocialAccount: (...args: unknown[]) => mockUpdateSocialAccount(...args),
  countSocialPostsForAccount: (...args: unknown[]) =>
    mockCountSocialPostsForAccount(...args),
  createOAuthState: (...args: unknown[]) => mockCreateOAuthState(...args),
  consumeOAuthState: (...args: unknown[]) => mockConsumeOAuthState(...args),
  getOAuthStateByState: (...args: unknown[]) => mockGetOAuthStateByState(...args),
  createOAuthSelectionSession: (...args: unknown[]) => mockCreateOAuthSelectionSession(...args),
  consumeOAuthSelectionSession: (...args: unknown[]) => mockConsumeOAuthSelectionSession(...args),
  getOAuthSelectionSession: (...args: unknown[]) =>
    mockGetOAuthSelectionSession(...args),
  countActiveSocialAccounts: (...args: unknown[]) => mockCountActiveSocialAccounts(...args),
  upsertSocialAccount: (...args: unknown[]) => mockUpsertSocialAccount(...args),
  SocialAccountNotFoundError: class extends Error {
    constructor(id?: string) { super(`Account "${id}" not found.`); this.name = "SocialAccountNotFoundError"; }
  },
  OAuthStateNotFoundError: class extends Error {
    constructor() { super("OAuth state not found."); this.name = "OAuthStateNotFoundError"; }
  },
  OAuthStateExpiredError: class extends Error {
    constructor() { super("OAuth state expired."); this.name = "OAuthStateExpiredError"; }
  },
  OAuthSelectionSessionNotFoundError: class extends Error {
    constructor() { super("Selection session not found."); this.name = "OAuthSelectionSessionNotFoundError"; }
  },
  OAuthSelectionSessionExpiredError: class extends Error {
    constructor() { super("Selection session expired."); this.name = "OAuthSelectionSessionExpiredError"; }
  },
}));

vi.mock("@/lib/social/provider-registry", () => ({
  registerProvider: vi.fn(),
  clearRegistry: vi.fn(),
  getProvider: (...args: unknown[]) => mockGetProvider(...args),
  isProviderRegistered: (...args: unknown[]) => mockIsProviderRegistered(...args),
}));

vi.mock("@/lib/social/platform-config", () => ({
  isPlatformConfigured: (...args: unknown[]) => mockIsPlatformConfigured(...args),
}));

vi.mock("@/lib/social/crypto", () => ({
  encryptToken: (...args: unknown[]) => mockEncryptToken(...args),
  decryptToken: (...args: unknown[]) => mockDecryptToken(...args),
}));

const mockSession = {
  user: { id: "user_1", name: "Test", email: "test@example.com" },
  workspace: { id: "ws_1", organizationId: "org_1" },
  role: "owner" as const,
  planTier: "free" as const,
  permissions: ["social:view", "social:connect", "social:manage"],
};

function authorized() {
  mockWithApiPermission.mockResolvedValue({ authorized: true, session: mockSession });
}

function unauthorized(status: 401 | 403) {
  mockWithApiPermission.mockResolvedValue({
    authorized: false,
    response: NextResponse.json(
      { success: false, error: status === 401 ? "Unauthenticated" : "Forbidden" },
      { status },
    ),
  });
}

function createRequest(
  url = "http://localhost:3000/api/social/accounts",
  init?: RequestInit,
): NextRequest {
  return new NextRequest(url, init as ConstructorParameters<typeof NextRequest>[1]);
}

describe("/api/social/accounts GET", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCountSocialPostsForAccount.mockResolvedValue(0);
  });

  it("returns 401 for unauthenticated requests", async () => {
    unauthorized(401);
    const { GET } = await import("../../accounts/route");
    const response = await GET(createRequest());
    expect(response.status).toBe(401);
  });

  it("returns 403 for unauthorized requests", async () => {
    unauthorized(403);
    const { GET } = await import("../../accounts/route");
    const response = await GET(createRequest());
    expect(response.status).toBe(403);
  });

  it("lists accounts for workspace (strips tokens)", async () => {
    authorized();
    mockListSocialAccounts.mockResolvedValue([
      {
        id: "sacct_1",
        platform: "linkedin",
        displayName: "Test",
        accessTokenEncrypted: "enc_secret",
        refreshTokenEncrypted: "enc_refresh",
        accessTokenSecret: null,
      },
    ]);
    const { GET } = await import("../../accounts/route");
    const response = await GET(createRequest());
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.accounts).toHaveLength(1);
    // Encrypted tokens should be stripped
    expect(data.accounts[0]).not.toHaveProperty("accessTokenEncrypted");
    expect(data.accounts[0]).not.toHaveProperty("refreshTokenEncrypted");
    expect(data.accounts[0]).not.toHaveProperty("accessTokenSecret");
  });
});

describe("/api/social/accounts/connect POST", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIsPlatformConfigured.mockReturnValue(true);
  });

  it("returns 401 for unauthenticated requests", async () => {
    unauthorized(401);
    const { POST } = await import("../../accounts/connect/route");
    const response = await POST(
      createRequest("http://localhost:3000/api/social/accounts/connect", {
        method: "POST",
        body: JSON.stringify({ platform: "linkedin" }),
      }),
    );
    expect(response.status).toBe(401);
  });

  it("returns 400 for missing platform", async () => {
    authorized();
    const { POST } = await import("../../accounts/connect/route");
    const response = await POST(
      createRequest("http://localhost:3000/api/social/accounts/connect", {
        method: "POST",
        body: JSON.stringify({}),
      }),
    );
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toContain("Platform is required");
  });

  it("returns 400 for unregistered platform", async () => {
    authorized();
    mockIsProviderRegistered.mockReturnValue(false);
    const { POST } = await import("../../accounts/connect/route");
    const response = await POST(
      createRequest("http://localhost:3000/api/social/accounts/connect", {
        method: "POST",
        body: JSON.stringify({ platform: "unknown" }),
      }),
    );
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toContain("not available");
  });

  it("returns 400 for a registered but unconfigured platform, without leaking env var names", async () => {
    authorized();
    mockIsProviderRegistered.mockReturnValue(true);
    mockIsPlatformConfigured.mockReturnValue(false);

    const { POST } = await import("../../accounts/connect/route");
    const response = await POST(
      createRequest("http://localhost:3000/api/social/accounts/connect", {
        method: "POST",
        body: JSON.stringify({ platform: "x" }),
      }),
    );
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.success).toBe(false);
    expect(data.code).toBe("platform_not_configured");
    expect(data.error).toContain("not configured");
    expect(JSON.stringify(data)).not.toMatch(/X_API_KEY|X_API_SECRET|_CLIENT_ID|_CLIENT_SECRET/);
    // Must never reach the provider (no dead-end mid-OAuth attempt)
    expect(mockGetProvider).not.toHaveBeenCalled();
    expect(mockCreateOAuthState).not.toHaveBeenCalled();
  });

  it("returns authUrl for valid platform", async () => {
    authorized();
    mockIsProviderRegistered.mockReturnValue(true);
    mockCountActiveSocialAccounts.mockResolvedValue(1);
    mockGetProvider.mockReturnValue({
      generateAuthUrl: vi.fn().mockResolvedValue({
        url: "https://linkedin.com/oauth?...",
        state: "test-state",
        codeVerifier: "test-verifier",
      }),
    });
    mockCreateOAuthState.mockResolvedValue({ id: "soauth_1" });

    const { POST } = await import("../../accounts/connect/route");
    const response = await POST(
      createRequest("http://localhost:3000/api/social/accounts/connect", {
        method: "POST",
        headers: { origin: "http://localhost:3000" },
        body: JSON.stringify({ platform: "linkedin" }),
      }),
    );
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.authUrl).toBe("https://linkedin.com/oauth?...");
    expect(mockCreateOAuthState).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: "ws_1",
        platform: "linkedin",
        state: "test-state",
        codeVerifier: "test-verifier",
      }),
    );
  });

  it("returns 402 when channel quota is exceeded", async () => {
    authorized();
    mockIsProviderRegistered.mockReturnValue(true);
    mockCountActiveSocialAccounts.mockResolvedValue(3);

    const { POST } = await import("../../accounts/connect/route");
    const response = await POST(
      createRequest("http://localhost:3000/api/social/accounts/connect", {
        method: "POST",
        body: JSON.stringify({ platform: "linkedin" }),
      }),
    );
    const data = await response.json();
    expect(response.status).toBe(402);
    expect(data.success).toBe(false);
    expect(data.code).toBe("quota_exceeded");
    expect(data.section).toBe("channels");
  });
});

describe("/api/social/accounts/callback POST", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 400 for missing fields", async () => {
    authorized();
    const { POST } = await import("../../accounts/callback/route");
    const response = await POST(
      createRequest("http://localhost:3000/api/social/accounts/callback", {
        method: "POST",
        body: JSON.stringify({ platform: "linkedin" }),
      }),
    );
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toContain("required");
  });

  it("returns 400 for expired OAuth state", async () => {
    authorized();
    const { OAuthStateExpiredError } = await import("@/lib/social/repository");
    mockConsumeOAuthState.mockRejectedValue(new OAuthStateExpiredError());

    const { POST } = await import("../../accounts/callback/route");
    const response = await POST(
      createRequest("http://localhost:3000/api/social/accounts/callback", {
        method: "POST",
        body: JSON.stringify({ platform: "linkedin", code: "abc", state: "expired-state" }),
      }),
    );
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toContain("expired");
  });

  it("creates account on successful OAuth callback", async () => {
    authorized();
    mockConsumeOAuthState.mockResolvedValue({
      id: "soauth_1",
      workspaceId: "ws_1",
      platform: "linkedin",
      codeVerifier: "test-verifier",
      metadata: { callbackUrl: "http://localhost:3000/api/social/accounts/callback" },
    });
    const mockAuthenticate = vi.fn().mockResolvedValue({
      platformUserId: "li_user_123",
      accessToken: "access_tok",
      refreshToken: "refresh_tok",
      expiresIn: 3600,
      displayName: "Test User",
      username: "testuser",
      requiresPageSelection: false,
    });
    mockGetProvider.mockReturnValue({
      authenticate: mockAuthenticate,
    });
    mockEncryptToken.mockImplementation((t: string) => `enc_${t}`);
    mockUpsertSocialAccount.mockResolvedValue({
      id: "sacct_1",
      platform: "linkedin",
      displayName: "Test User",
      accessTokenEncrypted: "enc_access_tok",
      refreshTokenEncrypted: "enc_refresh_tok",
      accessTokenSecret: null,
    });

    const { POST } = await import("../../accounts/callback/route");
    const response = await POST(
      createRequest("http://localhost:3000/api/social/accounts/callback", {
        method: "POST",
        body: JSON.stringify({ platform: "linkedin", code: "auth_code", state: "valid-state" }),
      }),
    );
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.account).toBeDefined();
    // Tokens should be stripped from response
    expect(data.account).not.toHaveProperty("accessTokenEncrypted");
    expect(mockAuthenticate).toHaveBeenCalledWith({
      code: "auth_code",
      state: "valid-state",
      redirectUri: "http://localhost:3000/api/social/accounts/callback",
      codeVerifier: "test-verifier",
    });
    expect(mockEncryptToken).toHaveBeenCalledWith("access_tok");
    expect(mockEncryptToken).toHaveBeenCalledWith("refresh_tok");
  });

  it("returns selectionSessionId for page-selection providers", async () => {
    authorized();
    mockConsumeOAuthState.mockResolvedValue({
      id: "soauth_1",
      workspaceId: "ws_1",
      platform: "facebook",
      codeVerifier: "test-verifier",
      metadata: { callbackUrl: "http://localhost:3000/api/social/accounts/callback" },
    });
    mockGetProvider.mockReturnValue({
      authenticate: vi.fn().mockResolvedValue({
        platformUserId: "fb_user_123",
        accessToken: "access_tok",
        refreshToken: "refresh_tok",
        expiresIn: 3600,
        displayName: "Test Page",
        username: "testpage",
        requiresPageSelection: true,
      }),
      fetchPageInformation: vi.fn().mockResolvedValue([
        { id: "pg_1", name: "Page One" },
      ]),
    });
    mockEncryptToken.mockImplementation((t: string) => `enc_${t}`);
    mockCreateOAuthSelectionSession.mockResolvedValue({ id: "sosel_1" });

    const { POST } = await import("../../accounts/callback/route");
    const response = await POST(
      createRequest("http://localhost:3000/api/social/accounts/callback", {
        method: "POST",
        body: JSON.stringify({ platform: "facebook", code: "auth_code", state: "valid-state" }),
      }),
    );
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.requiresPageSelection).toBe(true);
    expect(data.selectionSessionId).toBe("sosel_1");
    expect(data.pages).toHaveLength(1);
    expect(data).not.toHaveProperty("account");
    expect(mockCreateOAuthSelectionSession).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: "ws_1",
        platform: "facebook",
      }),
    );
  });
});

describe("/api/social/accounts/select-page POST", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 400 for missing selectionSessionId", async () => {
    authorized();
    const { POST } = await import("../../accounts/select-page/route");
    const response = await POST(
      createRequest("http://localhost:3000/api/social/accounts/select-page", {
        method: "POST",
        body: JSON.stringify({ platform: "facebook", pageId: "pg_1" }),
      }),
    );
    const data = await response.json();
    expect(response.status).toBe(400);
    expect(data.error).toContain("selectionSessionId");
  });

  it("uses selection session to complete page connect without raw client tokens", async () => {
    authorized();
    const selectionSession = {
      id: "sosel_1",
      workspaceId: "ws_1",
      platform: "facebook",
      accessTokenEncrypted: "enc_access",
      refreshTokenEncrypted: "enc_refresh",
      accessTokenSecret: null,
      tokenExpiresAt: new Date("2026-01-01T00:00:00.000Z"),
      expiresAt: new Date("2026-01-01T00:10:00.000Z"),
    };
    mockGetOAuthSelectionSession.mockResolvedValue(selectionSession);
    mockConsumeOAuthSelectionSession.mockResolvedValue(selectionSession);
    mockDecryptToken.mockReturnValue("plain_access");
    mockGetProvider.mockReturnValue({
      fetchPageInformation: vi.fn().mockResolvedValue([
        { id: "pg_1", name: "Page One", accessToken: "page_token_1" },
      ]),
    });
    mockEncryptToken.mockImplementation((t: string) => `enc_${t}`);
    mockUpsertSocialAccount.mockResolvedValue({
      id: "sacct_1",
      platform: "facebook",
      displayName: "Page One",
      accessTokenEncrypted: "enc_page_token_1",
      refreshTokenEncrypted: "enc_refresh",
      accessTokenSecret: null,
    });

    const { POST } = await import("../../accounts/select-page/route");
    const response = await POST(
      createRequest("http://localhost:3000/api/social/accounts/select-page", {
        method: "POST",
        body: JSON.stringify({
          platform: "facebook",
          pageId: "pg_1",
          selectionSessionId: "sosel_1",
        }),
      }),
    );
    const data = await response.json();
    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.account).not.toHaveProperty("accessTokenEncrypted");
    expect(mockGetOAuthSelectionSession).toHaveBeenCalledWith({
      selectionSessionId: "sosel_1",
      workspaceId: "ws_1",
      platform: "facebook",
    });
    expect(mockConsumeOAuthSelectionSession).toHaveBeenCalledWith({
      selectionSessionId: "sosel_1",
      workspaceId: "ws_1",
      platform: "facebook",
    });
  });
});

describe("/api/social/accounts/[accountId] DELETE", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 401 for unauthenticated requests", async () => {
    unauthorized(401);
    const mod = await import("../../accounts/[accountId]/route");
    const response = await mod.DELETE(
      createRequest("http://localhost:3000/api/social/accounts/sacct_1", { method: "DELETE" }),
      { params: Promise.resolve({ accountId: "sacct_1" }) },
    );
    expect(response.status).toBe(401);
  });

  it("disconnects account successfully", async () => {
    authorized();
    mockCountSocialPostsForAccount.mockResolvedValue(0);
    mockDisconnectSocialAccount.mockResolvedValue(undefined);

    const mod = await import("../../accounts/[accountId]/route");
    const response = await mod.DELETE(
      createRequest("http://localhost:3000/api/social/accounts/sacct_1", { method: "DELETE" }),
      { params: Promise.resolve({ accountId: "sacct_1" }) },
    );
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(mockCountSocialPostsForAccount).toHaveBeenCalledWith("ws_1", "sacct_1");
    expect(mockDisconnectSocialAccount).toHaveBeenCalledWith("ws_1", "sacct_1");
  });

  it("returns 404 for unknown account", async () => {
    authorized();
    mockCountSocialPostsForAccount.mockResolvedValue(0);
    const { SocialAccountNotFoundError } = await import("@/lib/social/repository");
    mockDisconnectSocialAccount.mockRejectedValue(new SocialAccountNotFoundError("sacct_missing"));

    const mod = await import("../../accounts/[accountId]/route");
    const response = await mod.DELETE(
      createRequest("http://localhost:3000/api/social/accounts/sacct_missing", { method: "DELETE" }),
      { params: Promise.resolve({ accountId: "sacct_missing" }) },
    );

    expect(response.status).toBe(404);
  });

  it("returns 409 when account has linked posts without force", async () => {
    authorized();
    mockCountSocialPostsForAccount.mockResolvedValue(3);
    const mod = await import("../../accounts/[accountId]/route");
    const response = await mod.DELETE(
      createRequest("http://localhost:3000/api/social/accounts/sacct_1", {
        method: "DELETE",
      }),
      { params: Promise.resolve({ accountId: "sacct_1" }) },
    );

    expect(response.status).toBe(409);
    expect(mockDisconnectSocialAccount).not.toHaveBeenCalled();
  });

  it("allows force disconnect when account has linked posts", async () => {
    authorized();
    mockCountSocialPostsForAccount.mockResolvedValue(3);
    mockDisconnectSocialAccount.mockResolvedValue(undefined);

    const mod = await import("../../accounts/[accountId]/route");
    const response = await mod.DELETE(
      createRequest(
        "http://localhost:3000/api/social/accounts/sacct_1?force=true",
        { method: "DELETE" },
      ),
      { params: Promise.resolve({ accountId: "sacct_1" }) },
    );

    expect(response.status).toBe(200);
    expect(mockDisconnectSocialAccount).toHaveBeenCalledWith("ws_1", "sacct_1");
  });
});

describe("/api/social/accounts/[accountId] PATCH", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 401 for unauthenticated requests", async () => {
    unauthorized(401);
    const mod = await import("../../accounts/[accountId]/route");
    const response = await mod.PATCH(
      createRequest("http://localhost:3000/api/social/accounts/sacct_1", {
        method: "PATCH",
        body: JSON.stringify({ displayName: "New Name" }),
      }),
      { params: Promise.resolve({ accountId: "sacct_1" }) },
    );
    expect(response.status).toBe(401);
  });

  it("updates displayName successfully", async () => {
    authorized();
    mockUpdateSocialAccount.mockResolvedValue({
      id: "sacct_1",
      platform: "linkedin",
      displayName: "New Name",
      accessTokenEncrypted: "enc_secret",
      refreshTokenEncrypted: "enc_refresh",
      accessTokenSecret: null,
    });

    const mod = await import("../../accounts/[accountId]/route");
    const response = await mod.PATCH(
      createRequest("http://localhost:3000/api/social/accounts/sacct_1", {
        method: "PATCH",
        body: JSON.stringify({ displayName: "New Name" }),
      }),
      { params: Promise.resolve({ accountId: "sacct_1" }) },
    );
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.account.displayName).toBe("New Name");
    expect(data.account).not.toHaveProperty("accessTokenEncrypted");
    expect(mockUpdateSocialAccount).toHaveBeenCalledWith("ws_1", "sacct_1", {
      displayName: "New Name",
    });
  });

  it("returns 400 for empty displayName", async () => {
    authorized();
    const mod = await import("../../accounts/[accountId]/route");
    const response = await mod.PATCH(
      createRequest("http://localhost:3000/api/social/accounts/sacct_1", {
        method: "PATCH",
        body: JSON.stringify({ displayName: "" }),
      }),
      { params: Promise.resolve({ accountId: "sacct_1" }) },
    );
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toContain("displayName");
  });

  it("returns 400 for non-boolean disabled", async () => {
    authorized();
    const mod = await import("../../accounts/[accountId]/route");
    const response = await mod.PATCH(
      createRequest("http://localhost:3000/api/social/accounts/sacct_1", {
        method: "PATCH",
        body: JSON.stringify({ disabled: "yes" }),
      }),
      { params: Promise.resolve({ accountId: "sacct_1" }) },
    );
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toContain("disabled");
  });

  it("returns 400 for non-object additionalSettings", async () => {
    authorized();
    const mod = await import("../../accounts/[accountId]/route");
    const response = await mod.PATCH(
      createRequest("http://localhost:3000/api/social/accounts/sacct_1", {
        method: "PATCH",
        body: JSON.stringify({ additionalSettings: "invalid" }),
      }),
      { params: Promise.resolve({ accountId: "sacct_1" }) },
    );
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toContain("additionalSettings");
  });

  it("returns 400 for oversized additionalSettings", async () => {
    authorized();
    const mod = await import("../../accounts/[accountId]/route");
    const response = await mod.PATCH(
      createRequest("http://localhost:3000/api/social/accounts/sacct_1", {
        method: "PATCH",
        body: JSON.stringify({ additionalSettings: { data: "x".repeat(11_000) } }),
      }),
      { params: Promise.resolve({ accountId: "sacct_1" }) },
    );
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toContain("maximum size");
  });

  it("returns 404 for unknown account", async () => {
    authorized();
    const { SocialAccountNotFoundError } = await import("@/lib/social/repository");
    mockUpdateSocialAccount.mockRejectedValue(new SocialAccountNotFoundError("sacct_missing"));

    const mod = await import("../../accounts/[accountId]/route");
    const response = await mod.PATCH(
      createRequest("http://localhost:3000/api/social/accounts/sacct_missing", {
        method: "PATCH",
        body: JSON.stringify({ displayName: "Test" }),
      }),
      { params: Promise.resolve({ accountId: "sacct_missing" }) },
    );

    expect(response.status).toBe(404);
  });

  it("updates disabled flag successfully", async () => {
    authorized();
    mockUpdateSocialAccount.mockResolvedValue({
      id: "sacct_1",
      platform: "linkedin",
      displayName: "Test",
      disabled: true,
      accessTokenEncrypted: "enc_secret",
      refreshTokenEncrypted: "enc_refresh",
      accessTokenSecret: null,
    });

    const mod = await import("../../accounts/[accountId]/route");
    const response = await mod.PATCH(
      createRequest("http://localhost:3000/api/social/accounts/sacct_1", {
        method: "PATCH",
        body: JSON.stringify({ disabled: true }),
      }),
      { params: Promise.resolve({ accountId: "sacct_1" }) },
    );
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.account.disabled).toBe(true);
    expect(mockUpdateSocialAccount).toHaveBeenCalledWith("ws_1", "sacct_1", {
      disabled: true,
    });
  });
});
