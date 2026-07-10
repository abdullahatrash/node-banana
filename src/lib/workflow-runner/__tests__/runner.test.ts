import { describe, expect, it, vi } from "vitest";

import { ToolError } from "@/lib/agent-tools/errors";

import { assertProviderKeys, executeWorkflow } from "../runner";
import type { RunnerDeps, WorkflowGraph } from "../types";

function makeDeps(overrides: Partial<RunnerDeps> = {}): RunnerDeps {
  return {
    resolveKey: () => "key-123",
    generateImage: vi.fn(async () => ({ dataUrl: "data:image/png;base64,IMG" })),
    generateText: vi.fn(async () => ({ text: "generated text" })),
    saveImageAsset: vi.fn(async ({ nodeId }) => ({
      assetId: `asset_${nodeId}`,
      url: `https://cdn.example.com/${nodeId}.png`,
    })),
    ...overrides,
  };
}

// prompt -> nanoBanana -> output, plus an imageInput feeding the generator.
const IMAGE_GRAPH: WorkflowGraph = {
  nodes: [
    { id: "p1", type: "prompt", data: { prompt: "a cat" } },
    { id: "img1", type: "imageInput", data: { image: "data:image/png;base64,REF" } },
    {
      id: "gen1",
      type: "nanoBanana",
      data: { model: "nano-banana-pro", aspectRatio: "1:1" },
    },
    { id: "out1", type: "output", data: {} },
  ],
  edges: [
    { source: "p1", target: "gen1", targetHandle: "text" },
    { source: "img1", target: "gen1", targetHandle: "image" },
    { source: "gen1", target: "out1", targetHandle: "image" },
  ],
};

describe("executeWorkflow — image pipeline", () => {
  it("passes upstream prompt and image into the generator and saves the output as an asset", async () => {
    const deps = makeDeps();
    const result = await executeWorkflow(IMAGE_GRAPH, deps);

    expect(result.status).toBe("succeeded");
    expect(deps.generateImage).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: "a cat",
        images: ["data:image/png;base64,REF"],
        model: "nano-banana-pro",
        aspectRatio: "1:1",
        apiKey: "key-123",
      }),
    );
    expect(result.outputs).toEqual([
      {
        nodeId: "gen1",
        assetId: "asset_gen1",
        url: "https://cdn.example.com/gen1.png",
      },
    ]);
    // Every node reports succeeded.
    expect(result.progress.nodes.every((n) => n.status === "succeeded")).toBe(true);
  });

  it("resolves an imageInput asset reference through resolveImageRef", async () => {
    const graph: WorkflowGraph = {
      nodes: [
        { id: "p1", type: "prompt", data: { prompt: "x" } },
        { id: "img1", type: "imageInput", data: { imageRef: "asset_abc" } },
        { id: "gen1", type: "nanoBanana", data: { model: "nano-banana" } },
      ],
      edges: [
        { source: "p1", target: "gen1" },
        { source: "img1", target: "gen1" },
      ],
    };
    const resolveImageRef = vi.fn(async () => "data:image/png;base64,RESOLVED");
    const deps = makeDeps({ resolveImageRef });

    await executeWorkflow(graph, deps);

    expect(resolveImageRef).toHaveBeenCalledWith("asset_abc");
    expect(deps.generateImage).toHaveBeenCalledWith(
      expect.objectContaining({ images: ["data:image/png;base64,RESOLVED"] }),
    );
  });
});

describe("executeWorkflow — text pipeline", () => {
  it("runs an llmGenerate node with the resolved provider key", async () => {
    const graph: WorkflowGraph = {
      nodes: [
        { id: "p1", type: "prompt", data: { prompt: "summarize" } },
        {
          id: "llm1",
          type: "llmGenerate",
          data: { provider: "openai", model: "gpt-4.1-mini", temperature: 0.5, maxTokens: 256 },
        },
        { id: "out1", type: "output", data: {} },
      ],
      edges: [
        { source: "p1", target: "llm1" },
        { source: "llm1", target: "out1" },
      ],
    };
    const deps = makeDeps({ resolveKey: (p) => (p === "openai" ? "sk-openai" : null) });

    const result = await executeWorkflow(graph, deps);

    expect(result.status).toBe("succeeded");
    expect(deps.generateText).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: "summarize",
        provider: "openai",
        model: "gpt-4.1-mini",
        temperature: 0.5,
        maxTokens: 256,
        apiKey: "sk-openai",
      }),
    );
    // Text pipelines produce no image assets.
    expect(result.outputs).toEqual([]);
  });
});

describe("executeWorkflow — failure handling", () => {
  it("records a failed node and marks the run failed without throwing", async () => {
    const deps = makeDeps({
      generateImage: vi.fn(async () => {
        throw new Error("provider 500");
      }),
    });

    const result = await executeWorkflow(IMAGE_GRAPH, deps);

    expect(result.status).toBe("failed");
    const gen = result.progress.nodes.find((n) => n.nodeId === "gen1");
    expect(gen?.status).toBe("failed");
    expect(gen?.error).toContain("provider 500");
    // Downstream node never ran.
    const out = result.progress.nodes.find((n) => n.nodeId === "out1");
    expect(out?.status).toBe("skipped");
    expect(result.error?.message).toContain("provider 500");
  });

  it("reports progress after each node transition", async () => {
    const seen: string[][] = [];
    const deps = makeDeps({
      onProgress: (p) => {
        seen.push(p.nodes.map((n) => `${n.nodeId}:${n.status}`));
      },
    });

    await executeWorkflow(IMAGE_GRAPH, deps);

    expect(seen.length).toBeGreaterThan(0);
    // Final snapshot: all succeeded.
    expect(seen[seen.length - 1].every((s) => s.endsWith(":succeeded"))).toBe(true);
  });
});

describe("assertProviderKeys", () => {
  it("throws byok_key_missing naming the provider when no key is resolved", () => {
    const graph: WorkflowGraph = {
      nodes: [
        { id: "p1", type: "prompt", data: { prompt: "x" } },
        { id: "gen1", type: "nanoBanana", data: { model: "nano-banana" } },
      ],
      edges: [{ source: "p1", target: "gen1" }],
    };

    let error: unknown;
    try {
      assertProviderKeys(graph, () => null);
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(ToolError);
    expect((error as ToolError).code).toBe("byok_key_missing");
    expect((error as ToolError).message).toContain("gemini");
  });

  it("passes when every needed provider key resolves", () => {
    const graph: WorkflowGraph = {
      nodes: [
        { id: "p1", type: "prompt", data: { prompt: "x" } },
        { id: "gen1", type: "nanoBanana", data: { model: "nano-banana" } },
      ],
      edges: [{ source: "p1", target: "gen1" }],
    };
    expect(() => assertProviderKeys(graph, () => "key")).not.toThrow();
  });

  it("rejects a non-Gemini image provider as unsupported", () => {
    const graph: WorkflowGraph = {
      nodes: [
        {
          id: "gen1",
          type: "nanoBanana",
          data: { model: "flux", selectedModel: { provider: "fal" } },
        },
      ],
      edges: [],
    };
    let error: unknown;
    try {
      assertProviderKeys(graph, () => "key");
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(ToolError);
    expect((error as ToolError).code).toBe("unsupported_node");
  });
});
