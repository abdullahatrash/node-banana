import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ApiClient } from "../../api/client";
import type {
  Asset,
  AssetDownloadUrlResult,
  AssetUploadResult,
  CreatePostResult,
  PostStatus,
  PostSummary,
  SocialAccount,
  Workspace,
} from "../../api/schemas";
import { UsageError } from "../../errors/errors";
import { authLogin, authStatus } from "../auth";
import { accountsList } from "../accounts";
import { assetsDownloadUrl, assetsList, assetsUpload } from "../assets";
import { resolveClient, type AppDeps } from "../context";
import { postCreate, postList, postStatus } from "../post";
import { workspacesList } from "../workspaces";

const WORKSPACE: Workspace = { id: "ws_1", name: "Acme", slug: "acme" };
const ACCOUNT: SocialAccount = {
  id: "acc_1",
  platform: "x",
  platformUserId: "123",
  displayName: "Acme Co",
  username: "acme",
  avatarUrl: null,
  tokenExpiresAt: null,
  requiresReauth: false,
  disabled: false,
  createdAt: "2026-01-01T00:00:00.000Z",
};
const ASSET: Asset = {
  id: "asset_1",
  projectId: null,
  type: "image",
  mimeType: "image/png",
  sizeBytes: 2048,
  width: 100,
  height: 100,
  durationSeconds: null,
  createdAt: "2026-01-02T00:00:00.000Z",
};
const UPLOAD_RESULT: AssetUploadResult = {
  assetId: "asset_new",
  downloadUrl: "https://cdn.example/asset_new.png",
  expiresInSeconds: null,
};
const DOWNLOAD_URL_RESULT: AssetDownloadUrlResult = {
  assetId: "asset_1",
  downloadUrl: "https://signed.example/asset_1.png",
  expiresInSeconds: 900,
};
const CREATE_POST_RESULT: CreatePostResult = {
  postId: "spost_new",
  status: "queued",
  scheduledAt: "2026-07-10T15:00:00.000Z",
};
const POST_SUMMARY: PostSummary = {
  postId: "spost_1",
  socialAccountId: "acc_1",
  platform: "x",
  status: "queued",
  dispatchStatus: "pending",
  content: "Hello",
  scheduledAt: "2026-07-10T15:00:00.000Z",
  publishedAt: null,
  failureReason: null,
  releaseUrl: null,
  createdAt: "2026-07-10T14:00:00.000Z",
};
const POST_STATUS: PostStatus = {
  postId: "spost_1",
  socialAccountId: "acc_1",
  status: "published",
  dispatchStatus: "dispatched",
  dispatchAttempts: 1,
  retryCount: 0,
  scheduledAt: "2026-07-10T15:00:00.000Z",
  publishedAt: "2026-07-10T15:00:05.000Z",
  nextDispatchAt: null,
  lastError: null,
  platformPostId: "tweet_1",
  releaseUrl: "https://x.com/acme/status/1",
  createdAt: "2026-07-10T14:00:00.000Z",
  updatedAt: "2026-07-10T15:00:05.000Z",
};

function makeDeps(overrides: Partial<AppDeps> = {}): {
  deps: AppDeps;
  out: string[];
  err: string[];
  client: ApiClient;
  created: Array<{ token: string; url: string }>;
} {
  const out: string[] = [];
  const err: string[] = [];
  const created: Array<{ token: string; url: string }> = [];

  const client: ApiClient = {
    listWorkspaces: vi.fn(async () => [WORKSPACE]),
    listSocialAccounts: vi.fn(async () => [ACCOUNT]),
    listAssets: vi.fn(async () => [ASSET]),
    uploadAsset: vi.fn(async () => UPLOAD_RESULT),
    getAssetDownloadUrl: vi.fn(async () => DOWNLOAD_URL_RESULT),
    createPost: vi.fn(async () => CREATE_POST_RESULT),
    listPosts: vi.fn(async () => [POST_SUMMARY]),
    getPostStatus: vi.fn(async () => POST_STATUS),
    verifyToken: vi.fn(async () => undefined),
  };

  const deps: AppDeps = {
    loadConfig: vi.fn(() => ({ token: "nb_secret", url: "https://api.example.com" })),
    saveConfig: vi.fn(),
    clearConfig: vi.fn(),
    createClient: vi.fn((options) => {
      created.push({ token: options.token, url: options.url });
      return client;
    }),
    promptSecret: vi.fn(async () => "nb_prompted"),
    readFile: vi.fn(() => Buffer.from("file-bytes")),
    io: { out: (line) => out.push(line), err: (line) => err.push(line) },
    ...overrides,
  };

  return { deps, out, err, client, created };
}

describe("resolveClient", () => {
  it("throws a UsageError when there is no stored config", () => {
    const { deps } = makeDeps({ loadConfig: () => null });
    expect(() => resolveClient(deps)).toThrow(UsageError);
  });

  it("builds a client from the stored token and url", () => {
    const { deps, created } = makeDeps();
    resolveClient(deps);
    expect(created[0]).toEqual({ token: "nb_secret", url: "https://api.example.com" });
  });
});

describe("workspaces list", () => {
  it("prints a human table by default", async () => {
    const { deps, out } = makeDeps();
    await workspacesList(deps, { json: false });
    const text = out.join("\n");
    expect(text).toContain("ID");
    expect(text).toContain("ws_1");
    expect(text).toContain("Acme");
    expect(text).toContain("acme");
  });

  it("prints exact JSON data with --json", async () => {
    const { deps, out } = makeDeps();
    await workspacesList(deps, { json: true });
    expect(JSON.parse(out.join("\n"))).toEqual([WORKSPACE]);
  });

  it("shows an empty-state message when there are no workspaces", async () => {
    const { deps, out, client } = makeDeps();
    (client.listWorkspaces as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    await workspacesList(deps, { json: false });
    expect(out.join("\n").toLowerCase()).toContain("no workspaces");
  });
});

describe("accounts list", () => {
  it("prints a human table including platform and username", async () => {
    const { deps, out } = makeDeps();
    await accountsList(deps, { json: false });
    const text = out.join("\n");
    expect(text).toContain("acc_1");
    expect(text).toContain("x");
    expect(text).toContain("acme");
  });

  it("prints exact JSON data with --json", async () => {
    const { deps, out } = makeDeps();
    await accountsList(deps, { json: true });
    expect(JSON.parse(out.join("\n"))).toEqual([ACCOUNT]);
  });
});

describe("assets list", () => {
  it("forwards type and limit filters to the client", async () => {
    const { deps, client } = makeDeps();
    await assetsList(deps, { json: false, type: "image", limit: 5 });
    expect(client.listAssets).toHaveBeenCalledWith({ type: "image", limit: 5 });
  });

  it("prints exact JSON data with --json", async () => {
    const { deps, out } = makeDeps();
    await assetsList(deps, { json: true });
    expect(JSON.parse(out.join("\n"))).toEqual([ASSET]);
  });
});

describe("assets upload", () => {
  it("reads the file, base64-encodes it, and infers type/mime from the extension", async () => {
    const { deps, client } = makeDeps();
    (deps.readFile as ReturnType<typeof vi.fn>).mockReturnValue(
      Buffer.from("hello world"),
    );

    await assetsUpload(deps, { json: false, file: "/tmp/photo.png" });

    expect(deps.readFile).toHaveBeenCalledWith("/tmp/photo.png");
    expect(client.uploadAsset).toHaveBeenCalledWith({
      assetType: "image",
      fileName: "photo.png",
      mimeType: "image/png",
      base64Content: Buffer.from("hello world").toString("base64"),
    });
  });

  it("lets --type and --mime-type override the inferred values", async () => {
    const { deps, client } = makeDeps();

    await assetsUpload(deps, {
      json: false,
      file: "/tmp/blob.bin",
      type: "video",
      mimeType: "video/mp4",
    });

    expect(client.uploadAsset).toHaveBeenCalledWith(
      expect.objectContaining({ assetType: "video", mimeType: "video/mp4" }),
    );
  });

  it("forwards --project-id when given", async () => {
    const { deps, client } = makeDeps();

    await assetsUpload(deps, {
      json: false,
      file: "/tmp/photo.png",
      projectId: "proj_1",
    });

    expect(client.uploadAsset).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: "proj_1" }),
    );
  });

  it("throws a UsageError when the type cannot be inferred and --type is omitted", async () => {
    const { deps, client } = makeDeps();

    await expect(
      assetsUpload(deps, { json: false, file: "/tmp/mystery.xyz" }),
    ).rejects.toThrow(UsageError);
    expect(client.uploadAsset).not.toHaveBeenCalled();
  });

  it("prints the asset id and download url by default", async () => {
    const { deps, out } = makeDeps();
    await assetsUpload(deps, { json: false, file: "/tmp/photo.png" });
    const text = out.join("\n");
    expect(text).toContain("asset_new");
    expect(text).toContain("https://cdn.example/asset_new.png");
  });

  it("prints exact JSON data with --json", async () => {
    const { deps, out } = makeDeps();
    await assetsUpload(deps, { json: true, file: "/tmp/photo.png" });
    expect(JSON.parse(out.join("\n"))).toEqual(UPLOAD_RESULT);
  });
});

describe("assets download-url", () => {
  it("requests a download url for the given asset id", async () => {
    const { deps, client } = makeDeps();
    await assetsDownloadUrl(deps, { json: false, assetId: "asset_1" });
    expect(client.getAssetDownloadUrl).toHaveBeenCalledWith("asset_1", undefined);
  });

  it("forwards --expires-in when given", async () => {
    const { deps, client } = makeDeps();
    await assetsDownloadUrl(deps, {
      json: false,
      assetId: "asset_1",
      expiresInSeconds: 60,
    });
    expect(client.getAssetDownloadUrl).toHaveBeenCalledWith("asset_1", {
      expiresInSeconds: 60,
    });
  });

  it("prints the download url by default", async () => {
    const { deps, out } = makeDeps();
    await assetsDownloadUrl(deps, { json: false, assetId: "asset_1" });
    expect(out.join("\n")).toContain("https://signed.example/asset_1.png");
  });

  it("prints exact JSON data with --json", async () => {
    const { deps, out } = makeDeps();
    await assetsDownloadUrl(deps, { json: true, assetId: "asset_1" });
    expect(JSON.parse(out.join("\n"))).toEqual(DOWNLOAD_URL_RESULT);
  });
});

describe("auth login", () => {
  it("verifies and stores a token passed via --token", async () => {
    const { deps, out } = makeDeps({ loadConfig: () => null });
    await authLogin(deps, {
      token: "nb_new",
      url: "https://app.example.com",
      json: false,
    });

    expect(deps.createClient).toHaveBeenCalledWith(
      expect.objectContaining({ token: "nb_new", url: "https://app.example.com" }),
    );
    expect(deps.saveConfig).toHaveBeenCalledWith({
      token: "nb_new",
      url: "https://app.example.com",
    });
    expect(out.join("\n").toLowerCase()).toContain("logged in");
  });

  it("prompts for the token when --token is omitted", async () => {
    const { deps } = makeDeps({ loadConfig: () => null });
    await authLogin(deps, { url: "https://app.example.com", json: false });

    expect(deps.promptSecret).toHaveBeenCalled();
    expect(deps.saveConfig).toHaveBeenCalledWith({
      token: "nb_prompted",
      url: "https://app.example.com",
    });
  });

  it("does not persist a token the API rejects", async () => {
    const { deps, client } = makeDeps({ loadConfig: () => null });
    (client.verifyToken as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error("Invalid or revoked API token."),
    );

    await expect(
      authLogin(deps, { token: "nb_bad", url: "https://app.example.com", json: false }),
    ).rejects.toThrow();
    expect(deps.saveConfig).not.toHaveBeenCalled();
  });

  it("emits machine-readable json on success", async () => {
    const { deps, out } = makeDeps({ loadConfig: () => null });
    await authLogin(deps, {
      token: "nb_new",
      url: "https://app.example.com",
      json: true,
    });
    expect(JSON.parse(out.join("\n"))).toEqual({
      authenticated: true,
      url: "https://app.example.com",
    });
  });
});

describe("post create", () => {
  it("creates a draft by default (no --schedule)", async () => {
    const { deps, client } = makeDeps();
    await postCreate(deps, { json: false, account: "acc_1", text: "Hi" });
    expect(client.createPost).toHaveBeenCalledWith({
      socialAccountId: "acc_1",
      content: "Hi",
      draft: true,
    });
  });

  it("publishes now with --schedule now", async () => {
    const { deps, client } = makeDeps();
    await postCreate(deps, {
      json: false,
      account: "acc_1",
      text: "Hi",
      schedule: "now",
    });
    expect(client.createPost).toHaveBeenCalledWith({
      socialAccountId: "acc_1",
      content: "Hi",
    });
  });

  it("schedules for an ISO timestamp and forwards media asset ids", async () => {
    const { deps, client } = makeDeps();
    await postCreate(deps, {
      json: false,
      account: "acc_1",
      text: "Hi",
      media: ["asset_1", "asset_2"],
      schedule: "2026-07-10T15:00:00.000Z",
    });
    expect(client.createPost).toHaveBeenCalledWith({
      socialAccountId: "acc_1",
      content: "Hi",
      mediaAssetIds: ["asset_1", "asset_2"],
      scheduledAt: "2026-07-10T15:00:00.000Z",
    });
  });

  it("rejects a create with neither text nor media", async () => {
    const { deps, client } = makeDeps();
    await expect(
      postCreate(deps, { json: false, account: "acc_1" }),
    ).rejects.toThrow(UsageError);
    expect(client.createPost).not.toHaveBeenCalled();
  });

  it("rejects an invalid --schedule value", async () => {
    const { deps, client } = makeDeps();
    await expect(
      postCreate(deps, {
        json: false,
        account: "acc_1",
        text: "Hi",
        schedule: "tomorrow",
      }),
    ).rejects.toThrow(UsageError);
    expect(client.createPost).not.toHaveBeenCalled();
  });

  it("prints exact JSON data with --json", async () => {
    const { deps, out } = makeDeps();
    await postCreate(deps, { json: true, account: "acc_1", text: "Hi" });
    expect(JSON.parse(out.join("\n"))).toEqual(CREATE_POST_RESULT);
  });
});

describe("post list", () => {
  it("forwards status, platform, account and limit filters", async () => {
    const { deps, client } = makeDeps();
    await postList(deps, {
      json: false,
      status: "queued",
      platform: "x",
      account: "acc_1",
      limit: 10,
    });
    expect(client.listPosts).toHaveBeenCalledWith({
      status: "queued",
      platform: "x",
      socialAccountId: "acc_1",
      limit: 10,
    });
  });

  it("prints a human table with dispatch status", async () => {
    const { deps, out } = makeDeps();
    await postList(deps, { json: false });
    const text = out.join("\n");
    expect(text).toContain("spost_1");
    expect(text).toContain("queued");
    expect(text).toContain("pending");
  });

  it("prints exact JSON data with --json", async () => {
    const { deps, out } = makeDeps();
    await postList(deps, { json: true });
    expect(JSON.parse(out.join("\n"))).toEqual([POST_SUMMARY]);
  });

  it("shows an empty-state message when there are no posts", async () => {
    const { deps, out, client } = makeDeps();
    (client.listPosts as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    await postList(deps, { json: false });
    expect(out.join("\n").toLowerCase()).toContain("no posts");
  });
});

describe("post status", () => {
  it("requests the given post id", async () => {
    const { deps, client } = makeDeps();
    await postStatus(deps, { json: false, postId: "spost_1" });
    expect(client.getPostStatus).toHaveBeenCalledWith("spost_1");
  });

  it("prints the release url and dispatch state", async () => {
    const { deps, out } = makeDeps();
    await postStatus(deps, { json: false, postId: "spost_1" });
    const text = out.join("\n");
    expect(text).toContain("published");
    expect(text).toContain("https://x.com/acme/status/1");
  });

  it("prints exact JSON data with --json", async () => {
    const { deps, out } = makeDeps();
    await postStatus(deps, { json: true, postId: "spost_1" });
    expect(JSON.parse(out.join("\n"))).toEqual(POST_STATUS);
  });
});

describe("auth status", () => {
  it("reports the authenticated url and a masked token", async () => {
    const { deps, out } = makeDeps();
    await authStatus(deps, { json: false });
    const text = out.join("\n");
    expect(text.toLowerCase()).toContain("https://api.example.com");
    // The raw token must never be printed in full.
    expect(text).not.toContain("nb_secret");
  });

  it("reports not-authenticated as json when no config exists", async () => {
    const { deps, out } = makeDeps({ loadConfig: () => null });
    await authStatus(deps, { json: true });
    expect(JSON.parse(out.join("\n"))).toEqual({
      authenticated: false,
      url: null,
    });
  });
});
