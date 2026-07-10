import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ApiClient } from "../../api/client";
import { createApiClient } from "../../api/client";
import type { RunStatus } from "../../api/schemas";
import { ApiError, UsageError } from "../../errors/errors";
import type { AppDeps } from "../context";
import { parseProviderKeys, run, runsStatus } from "../runs";

const SUCCEEDED: RunStatus = {
  runId: "run_1",
  status: "succeeded",
  progress: {
    nodes: [{ nodeId: "gen1", type: "nanoBanana", status: "succeeded" }],
  },
  outputs: [{ nodeId: "gen1", assetId: "asset_9", url: "https://cdn/x.png" }],
  error: null,
};

function makeDeps(clientOverrides: Partial<ApiClient> = {}): {
  deps: AppDeps;
  out: string[];
  err: string[];
  client: ApiClient;
} {
  const out: string[] = [];
  const err: string[] = [];
  const client: ApiClient = {
    listWorkspaces: vi.fn(async () => []),
    listSocialAccounts: vi.fn(async () => []),
    listAssets: vi.fn(async () => []),
    runWorkflow: vi.fn(async () => ({ runId: "run_1", status: "queued" })),
    getRunStatus: vi.fn(async () => SUCCEEDED),
    verifyToken: vi.fn(async () => undefined),
    ...clientOverrides,
  };
  const deps: AppDeps = {
    loadConfig: () => ({ token: "nb_secret", url: "https://api.example.com" }),
    saveConfig: vi.fn(),
    clearConfig: vi.fn(),
    createClient: vi.fn(() => client),
    promptSecret: vi.fn(async () => "nb_x"),
    sleep: vi.fn(async () => undefined),
    io: { out: (l) => out.push(l), err: (l) => err.push(l) },
  };
  return { deps, out, err, client };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("parseProviderKeys", () => {
  it("parses provider=value pairs", () => {
    expect(parseProviderKeys(["gemini=gk", "openai=ok"])).toEqual({
      gemini: "gk",
      openai: "ok",
    });
  });

  it("rejects a malformed pair", () => {
    expect(() => parseProviderKeys(["gemini"])).toThrow(UsageError);
  });

  it("rejects an unknown provider", () => {
    expect(() => parseProviderKeys(["mystery=x"])).toThrow(UsageError);
  });
});

describe("nb run", () => {
  it("starts a run and prints the runId without --wait", async () => {
    const { deps, out, client } = makeDeps();

    await run(deps, {
      projectId: "proj_1",
      json: false,
      wait: false,
      keys: ["gemini=gk"],
    });

    expect(client.runWorkflow).toHaveBeenCalledWith({
      projectId: "proj_1",
      providerKeys: { gemini: "gk" },
    });
    expect(out.join("\n")).toContain("run_1");
    expect(client.getRunStatus).not.toHaveBeenCalled();
  });

  it("emits machine-readable JSON with --json", async () => {
    const { deps, out } = makeDeps();

    await run(deps, { projectId: "proj_1", json: true, wait: false, keys: [] });

    expect(JSON.parse(out[0])).toEqual({ runId: "run_1", status: "queued" });
  });

  it("polls until terminal and prints outputs with --wait", async () => {
    const getRunStatus = vi
      .fn<ApiClient["getRunStatus"]>()
      .mockResolvedValueOnce({ ...SUCCEEDED, status: "running" })
      .mockResolvedValueOnce(SUCCEEDED);
    const { deps, out } = makeDeps({ getRunStatus });

    await run(deps, {
      projectId: "proj_1",
      json: false,
      wait: true,
      keys: [],
      pollIntervalMs: 1,
      maxPolls: 5,
    });

    expect(getRunStatus).toHaveBeenCalledTimes(2);
    expect(deps.sleep).toHaveBeenCalledTimes(1);
    expect(out.join("\n")).toContain("asset_9");
  });

  it("throws an ApiError (exit 1) when a --wait run fails", async () => {
    const failed: RunStatus = {
      runId: "run_1",
      status: "failed",
      progress: { nodes: [] },
      outputs: [],
      error: { code: "internal", message: "provider 500" },
    };
    const { deps } = makeDeps({ getRunStatus: vi.fn(async () => failed) });

    await expect(
      run(deps, {
        projectId: "proj_1",
        json: false,
        wait: true,
        keys: [],
        pollIntervalMs: 1,
        maxPolls: 2,
      }),
    ).rejects.toBeInstanceOf(ApiError);
  });
});

describe("nb runs status", () => {
  it("prints a run's status", async () => {
    const { deps, out } = makeDeps();

    await runsStatus(deps, { runId: "run_1", json: false });

    expect(out.join("\n")).toContain("run_1");
    expect(out.join("\n")).toContain("succeeded");
  });

  it("emits JSON with --json", async () => {
    const { deps, out } = makeDeps();

    await runsStatus(deps, { runId: "run_1", json: true });

    expect(JSON.parse(out[0]).runId).toBe("run_1");
  });
});

// ---- API client wire-level tests (POST body + status GET) ----

interface Captured {
  url: string;
  method: string;
  body: unknown;
}

function capturingFetch(body: unknown): {
  fetch: typeof fetch;
  calls: Captured[];
} {
  const calls: Captured[] = [];
  const impl = (async (input: string | URL | Request, options?: RequestInit) => {
    calls.push({
      url: String(input),
      method: options?.method ?? "GET",
      body: options?.body ? JSON.parse(String(options.body)) : undefined,
    });
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as unknown as typeof fetch;
  return { fetch: impl, calls };
}

describe("api client runs methods", () => {
  it("POSTs projectId + providerKeys to /api/v1/runs", async () => {
    const { fetch, calls } = capturingFetch({
      success: true,
      runId: "run_1",
      status: "queued",
    });
    const client = createApiClient({
      token: "nb_secret",
      url: "https://api.example.com",
      fetchImpl: fetch,
    });

    const started = await client.runWorkflow({
      projectId: "proj_1",
      providerKeys: { gemini: "gk" },
    });

    expect(started).toEqual({ runId: "run_1", status: "queued" });
    expect(calls[0]?.method).toBe("POST");
    expect(calls[0]?.url).toBe("https://api.example.com/api/v1/runs");
    expect(calls[0]?.body).toEqual({
      projectId: "proj_1",
      providerKeys: { gemini: "gk" },
    });
  });

  it("GETs run status by id", async () => {
    const { fetch, calls } = capturingFetch({ success: true, ...SUCCEEDED });
    const client = createApiClient({
      token: "nb_secret",
      url: "https://api.example.com",
      fetchImpl: fetch,
    });

    const status = await client.getRunStatus("run_1");

    expect(status.outputs[0]?.assetId).toBe("asset_9");
    expect(calls[0]?.method).toBe("GET");
    expect(calls[0]?.url).toBe("https://api.example.com/api/v1/runs/run_1");
  });
});
