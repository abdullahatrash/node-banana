import type { z } from "zod";

import { ApiError } from "../errors/errors";
import {
  assetDownloadUrlResultSchema,
  assetUploadResultSchema,
  assetsResponseSchema,
  createPostResultSchema,
  postStatusSchema,
  postsResponseSchema,
  socialAccountsResponseSchema,
  workspacesResponseSchema,
  type Asset,
  type AssetDownloadUrlResult,
  type AssetType,
  type AssetUploadResult,
  type CreatePostResult,
  type PostStatus,
  type PostSummary,
  type SocialAccount,
  type Workspace,
} from "./schemas";

export interface ApiClientOptions {
  /** Workspace-scoped API token (the `nb_...` value). */
  token: string;
  /** Base URL of the hosted app, e.g. `https://app.example.com`. */
  url: string;
  /**
   * Injectable fetch — defaults to the global. Tests pass a fake; production
   * uses Node's built-in fetch. The CLI never imports server code, so this is
   * its only channel to the platform.
   */
  fetchImpl?: typeof fetch;
}

export interface UploadAssetInput {
  assetType: AssetType;
  projectId?: string;
  fileName?: string;
  mimeType?: string;
  /** Raw file bytes, base64-encoded. Exactly one of this or sourceUrl. */
  base64Content?: string;
  /** A URL the server fetches and stores. Exactly one of this or base64Content. */
  sourceUrl?: string;
}

export interface CreatePostInput {
  socialAccountId: string;
  content?: string;
  mediaAssetIds?: string[];
  draft?: boolean;
  /** ISO timestamp; omit (with draft omitted) to publish now. */
  scheduledAt?: string;
}

export interface ListPostsOptions {
  status?: string;
  platform?: string;
  socialAccountId?: string;
  startDate?: string;
  endDate?: string;
  limit?: number;
}

export interface ApiClient {
  listWorkspaces(): Promise<Workspace[]>;
  listSocialAccounts(): Promise<SocialAccount[]>;
  listAssets(options?: {
    type?: string;
    limit?: number;
  }): Promise<Asset[]>;
  uploadAsset(input: UploadAssetInput): Promise<AssetUploadResult>;
  getAssetDownloadUrl(
    assetId: string,
    options?: { expiresInSeconds?: number },
  ): Promise<AssetDownloadUrlResult>;
  createPost(input: CreatePostInput): Promise<CreatePostResult>;
  listPosts(options?: ListPostsOptions): Promise<PostSummary[]>;
  getPostStatus(postId: string): Promise<PostStatus>;
  /** Confirm the token is accepted; used by `nb auth login`. */
  verifyToken(): Promise<void>;
}

interface ErrorEnvelope {
  success: false;
  error?: unknown;
}

function isStructuredError(
  value: unknown,
): value is { code?: string; message: string; fix?: string } {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { message?: unknown }).message === "string"
  );
}

/**
 * Turn a non-success response body into an {@link ApiError}. Handles both API
 * error shapes: the structured `{ code, message, fix }` (registry routes) and
 * the bare `{ error: "..." }` string (the workspaces route).
 */
function toApiError(body: ErrorEnvelope, status: number): ApiError {
  const raw = body.error;
  if (isStructuredError(raw)) {
    return new ApiError({
      code: raw.code,
      message: raw.message,
      fix: raw.fix,
    });
  }
  if (typeof raw === "string") {
    return new ApiError({ message: raw });
  }
  return new ApiError({
    message: `Request failed with status ${status}.`,
    fix: "Check your token and API URL, then retry.",
  });
}

/**
 * Create a thin client over the public API. Every method issues one HTTP
 * request (GET by default, POST when a body is given), unwraps the
 * `{ success, ... }` envelope, validates the payload against a local schema,
 * and surfaces failures as {@link ApiError} (exit code 1).
 */
export function createApiClient(options: ApiClientOptions): ApiClient {
  const fetchImpl = options.fetchImpl ?? fetch;
  const baseUrl = options.url.replace(/\/+$/, "");

  async function requestJson(
    path: string,
    requestInit?: { method?: string; body?: unknown },
  ): Promise<Record<string, unknown>> {
    const url = `${baseUrl}${path}`;
    const hasBody = requestInit?.body !== undefined;

    let response: Response;
    try {
      response = await fetchImpl(url, {
        method: requestInit?.method ?? "GET",
        headers: {
          authorization: `Bearer ${options.token}`,
          accept: "application/json",
          ...(hasBody ? { "content-type": "application/json" } : {}),
        },
        ...(hasBody ? { body: JSON.stringify(requestInit!.body) } : {}),
      });
    } catch (cause) {
      throw new ApiError({
        message: `Could not reach ${baseUrl}: ${
          cause instanceof Error ? cause.message : String(cause)
        }`,
        fix: "Check the API URL (nb auth login --url ...) and your network.",
      });
    }

    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw new ApiError({
        message: `Received a non-JSON response (status ${response.status}) from ${url}.`,
        fix: "Confirm the API URL points at a Node Banana deployment.",
      });
    }

    if (
      !response.ok ||
      (typeof body === "object" &&
        body !== null &&
        (body as { success?: unknown }).success === false)
    ) {
      throw toApiError(body as ErrorEnvelope, response.status);
    }

    return body as Record<string, unknown>;
  }

  async function requestParsed<Schema extends z.ZodTypeAny>(
    path: string,
    schema: Schema,
    requestInit?: { method?: string; body?: unknown },
  ): Promise<z.infer<Schema>> {
    const body = await requestJson(path, requestInit);
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      throw new ApiError({
        code: "invalid_response",
        message: `The API returned data in an unexpected shape for ${path}.`,
        fix: "Update the CLI (npm i -g @node-banana/cli) so it matches the API.",
      });
    }
    return parsed.data;
  }

  return {
    async listWorkspaces() {
      const { workspaces } = await requestParsed(
        "/api/v1/workspaces",
        workspacesResponseSchema,
      );
      return workspaces;
    },

    async listSocialAccounts() {
      const { accounts } = await requestParsed(
        "/api/v1/social-accounts",
        socialAccountsResponseSchema,
      );
      return accounts;
    },

    async listAssets(listOptions) {
      const params = new URLSearchParams();
      if (listOptions?.type) params.set("type", listOptions.type);
      if (listOptions?.limit !== undefined) {
        params.set("limit", String(listOptions.limit));
      }
      const query = params.toString();
      const path = query ? `/api/v1/assets?${query}` : "/api/v1/assets";
      const { assets } = await requestParsed(path, assetsResponseSchema);
      return assets;
    },

    async uploadAsset(input) {
      return requestParsed("/api/v1/assets", assetUploadResultSchema, {
        method: "POST",
        body: input,
      });
    },

    async getAssetDownloadUrl(assetId, downloadOptions) {
      const params = new URLSearchParams();
      if (downloadOptions?.expiresInSeconds !== undefined) {
        params.set("expiresInSeconds", String(downloadOptions.expiresInSeconds));
      }
      const query = params.toString();
      const path = `/api/v1/assets/${encodeURIComponent(assetId)}/download-url${
        query ? `?${query}` : ""
      }`;
      return requestParsed(path, assetDownloadUrlResultSchema);
    },

    async createPost(input) {
      return requestParsed("/api/v1/social-posts", createPostResultSchema, {
        method: "POST",
        body: input,
      });
    },

    async listPosts(listOptions) {
      const params = new URLSearchParams();
      if (listOptions?.status) params.set("status", listOptions.status);
      if (listOptions?.platform) params.set("platform", listOptions.platform);
      if (listOptions?.socialAccountId) {
        params.set("socialAccountId", listOptions.socialAccountId);
      }
      if (listOptions?.startDate) params.set("startDate", listOptions.startDate);
      if (listOptions?.endDate) params.set("endDate", listOptions.endDate);
      if (listOptions?.limit !== undefined) {
        params.set("limit", String(listOptions.limit));
      }
      const query = params.toString();
      const path = query
        ? `/api/v1/social-posts?${query}`
        : "/api/v1/social-posts";
      const { posts } = await requestParsed(path, postsResponseSchema);
      return posts;
    },

    async getPostStatus(postId) {
      return requestParsed(
        `/api/v1/social-posts/${encodeURIComponent(postId)}`,
        postStatusSchema,
      );
    },

    async verifyToken() {
      await this.listWorkspaces();
    },
  };
}
