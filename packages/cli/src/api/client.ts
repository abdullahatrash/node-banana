import type { z } from "zod";

import { ApiError } from "../errors/errors";
import {
  assetsResponseSchema,
  runStartedSchema,
  runStatusSchema,
  socialAccountsResponseSchema,
  workspacesResponseSchema,
  type Asset,
  type RunStarted,
  type RunStatus,
  type SocialAccount,
  type Workspace,
} from "./schemas";

/** Provider keys passed to a run (BYOK); each maps to a provider's API key. */
export interface RunProviderKeys {
  gemini?: string;
  google?: string;
  openai?: string;
  anthropic?: string;
}

export interface RunWorkflowInput {
  projectId: string;
  inputOverrides?: Record<string, unknown>;
  providerKeys?: RunProviderKeys;
}

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

export interface ApiClient {
  listWorkspaces(): Promise<Workspace[]>;
  listSocialAccounts(): Promise<SocialAccount[]>;
  listAssets(options?: {
    type?: string;
    limit?: number;
  }): Promise<Asset[]>;
  /** Start a workflow run; returns the run id to poll. */
  runWorkflow(input: RunWorkflowInput): Promise<RunStarted>;
  /** Read a run's current status, progress, and output asset refs. */
  getRunStatus(runId: string): Promise<RunStatus>;
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
 * Create a thin client over the public API. Every method issues one GET,
 * unwraps the `{ success, ... }` envelope, validates the payload against a
 * local schema, and surfaces failures as {@link ApiError} (exit code 1).
 */
export function createApiClient(options: ApiClientOptions): ApiClient {
  const fetchImpl = options.fetchImpl ?? fetch;
  const baseUrl = options.url.replace(/\/+$/, "");

  async function requestJson(
    path: string,
    init?: { method?: string; body?: unknown },
  ): Promise<Record<string, unknown>> {
    const url = `${baseUrl}${path}`;

    let response: Response;
    try {
      response = await fetchImpl(url, {
        method: init?.method ?? "GET",
        headers: {
          authorization: `Bearer ${options.token}`,
          accept: "application/json",
          ...(init?.body !== undefined
            ? { "content-type": "application/json" }
            : {}),
        },
        ...(init?.body !== undefined
          ? { body: JSON.stringify(init.body) }
          : {}),
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
    init?: { method?: string; body?: unknown },
  ): Promise<z.infer<Schema>> {
    const body = await requestJson(path, init);
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

    async runWorkflow(input) {
      const body: Record<string, unknown> = { projectId: input.projectId };
      if (input.inputOverrides) body.inputOverrides = input.inputOverrides;
      if (input.providerKeys) body.providerKeys = input.providerKeys;
      return requestParsed("/api/v1/runs", runStartedSchema, {
        method: "POST",
        body,
      });
    },

    async getRunStatus(runId) {
      return requestParsed(
        `/api/v1/runs/${encodeURIComponent(runId)}`,
        runStatusSchema,
      );
    },

    async verifyToken() {
      await this.listWorkspaces();
    },
  };
}
