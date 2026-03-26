import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";

const mockWithApiPermission = vi.fn();
const mockListSocialAccounts = vi.fn();
const mockGetSocialAccount = vi.fn();
const mockDisconnectSocialAccount = vi.fn();
const mockCreateOAuthState = vi.fn();
const mockConsumeOAuthState = vi.fn();
const mockUpsertSocialAccount = vi.fn();
const mockGetProvider = vi.fn();
const mockIsProviderRegistered = vi.fn();
const mockEncryptToken = vi.fn();

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
  createOAuthState: (...args: unknown[]) => mockCreateOAuthState(...args),
  consumeOAuthState: (...args: unknown[]) => mockConsumeOAuthState(...args),
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
}));

vi.mock("@/lib/social/provider-registry", () => ({
  getProvider: (...args: unknown[]) => mockGetProvider(...args),
  isProviderRegistered: (...args: unknown[]) => mockIsProviderRegistered(...args),
}));

vi.mock("@/lib/social/crypto", () => ({
  encryptToken: (...args: unknown[]) => mockEncryptToken(...args),
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
  return new NextRequest(url, init);
}

describe("/api/social/accounts GET", () => {
  beforeEach(() => {
    vi.clearAllMocks();
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

  it("returns authUrl for valid platform", async () => {
    authorized();
    mockIsProviderRegistered.mockReturnValue(true);
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
    });
    mockGetProvider.mockReturnValue({
      authenticate: vi.fn().mockResolvedValue({
        platformUserId: "li_user_123",
        accessToken: "access_tok",
        refreshToken: "refresh_tok",
        expiresIn: 3600,
        displayName: "Test User",
        username: "testuser",
        requiresPageSelection: false,
      }),
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
    expect(mockEncryptToken).toHaveBeenCalledWith("access_tok");
    expect(mockEncryptToken).toHaveBeenCalledWith("refresh_tok");
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
    mockDisconnectSocialAccount.mockResolvedValue(undefined);

    const mod = await import("../../accounts/[accountId]/route");
    const response = await mod.DELETE(
      createRequest("http://localhost:3000/api/social/accounts/sacct_1", { method: "DELETE" }),
      { params: Promise.resolve({ accountId: "sacct_1" }) },
    );
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(mockDisconnectSocialAccount).toHaveBeenCalledWith("ws_1", "sacct_1");
  });

  it("returns 404 for unknown account", async () => {
    authorized();
    const { SocialAccountNotFoundError } = await import("@/lib/social/repository");
    mockDisconnectSocialAccount.mockRejectedValue(new SocialAccountNotFoundError("sacct_missing"));

    const mod = await import("../../accounts/[accountId]/route");
    const response = await mod.DELETE(
      createRequest("http://localhost:3000/api/social/accounts/sacct_missing", { method: "DELETE" }),
      { params: Promise.resolve({ accountId: "sacct_missing" }) },
    );

    expect(response.status).toBe(404);
  });
});
