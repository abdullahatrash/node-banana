import { ToolError, toStructuredError } from "@/lib/agent-tools/errors";

import { planExecution } from "./graph";
import {
  type NodeProgress,
  type ProviderKeyResolver,
  type RunnerDeps,
  type RunnerNode,
  type RunOutput,
  type RunProgress,
  type RunResult,
  type WorkflowGraph,
} from "./types";

/** Node types that consume an inference provider key. */
function providerForNode(node: RunnerNode): string | null {
  if (node.type === "nanoBanana") {
    const selected = node.data.selectedModel;
    const provider =
      typeof selected === "object" && selected !== null
        ? (selected as { provider?: unknown }).provider
        : undefined;
    // The server runner only round-trips Gemini image generation today.
    if (provider !== undefined && provider !== "gemini") {
      throw new ToolError({
        code: "unsupported_node",
        message: `The server runner only supports Gemini image generation; node ${node.id} uses provider '${String(
          provider,
        )}'.`,
        fix: "Switch the generate node to a Gemini model (nano-banana / nano-banana-pro), or run this workflow in the browser editor.",
      });
    }
    return "gemini";
  }
  if (node.type === "llmGenerate") {
    return typeof node.data.provider === "string" ? node.data.provider : "google";
  }
  return null;
}

/**
 * Validate — before any run row is created — that every node needing an
 * inference key can resolve one. This is where the BYOK contract surfaces: a
 * missing key is a typed `byok_key_missing` error naming the provider, not a
 * mid-run crash. Also rethrows `unsupported_node` for non-Gemini image nodes.
 */
export function assertProviderKeys(
  graph: WorkflowGraph,
  resolveKey: ProviderKeyResolver,
): void {
  for (const node of graph.nodes) {
    const provider = providerForNode(node);
    if (!provider) continue;
    const key = resolveKey(provider);
    if (!key) {
      throw new ToolError({
        code: "byok_key_missing",
        message: `No API key was supplied for provider '${provider}', required by node ${node.id}.`,
        fix: `Pass a provider key for '${provider}' with the request (e.g. providerKeys, or the X-*-API-Key header).`,
      });
    }
  }
}

interface NodeOutput {
  image?: string;
  text?: string;
}

/**
 * Gather the resolved inputs for `node` from its already-executed predecessors.
 * Mirrors the client `getConnectedInputs` contract: image inputs accept many
 * connections, text takes the first one found.
 */
function collectInputs(
  nodeId: string,
  graph: WorkflowGraph,
  outputs: Map<string, NodeOutput>,
): { images: string[]; text: string | null } {
  const images: string[] = [];
  let text: string | null = null;

  for (const edge of graph.edges) {
    if (edge.target !== nodeId) continue;
    const upstream = outputs.get(edge.source);
    if (!upstream) continue;
    if (typeof upstream.image === "string" && upstream.image.length > 0) {
      images.push(upstream.image);
    }
    if (text === null && typeof upstream.text === "string") {
      text = upstream.text;
    }
  }

  return { images, text };
}

async function executeNode(
  node: RunnerNode,
  graph: WorkflowGraph,
  deps: RunnerDeps,
  outputs: Map<string, NodeOutput>,
): Promise<RunOutput | null> {
  const { images, text } = collectInputs(node.id, graph, outputs);

  switch (node.type) {
    case "prompt": {
      const prompt = typeof node.data.prompt === "string" ? node.data.prompt : "";
      outputs.set(node.id, { text: prompt });
      return null;
    }

    case "imageInput": {
      let image =
        typeof node.data.image === "string" ? node.data.image : undefined;
      if (!image && typeof node.data.imageRef === "string" && deps.resolveImageRef) {
        image = await deps.resolveImageRef(node.data.imageRef);
      }
      if (!image) {
        throw new ToolError({
          code: "invalid_input",
          message: `Image input node ${node.id} has no image or resolvable asset reference.`,
          fix: "Attach an image (or an asset reference) to the image input node before running.",
        });
      }
      outputs.set(node.id, { image });
      return null;
    }

    case "llmGenerate": {
      const prompt = text ?? "";
      const provider =
        typeof node.data.provider === "string" ? node.data.provider : "google";
      const apiKey = deps.resolveKey(provider);
      if (!apiKey) {
        throw new ToolError({
          code: "byok_key_missing",
          message: `No API key was supplied for provider '${provider}', required by node ${node.id}.`,
          fix: `Pass a provider key for '${provider}' with the request.`,
        });
      }
      const result = await deps.generateText({
        prompt,
        images,
        provider,
        model: typeof node.data.model === "string" ? node.data.model : "",
        temperature:
          typeof node.data.temperature === "number" ? node.data.temperature : 0.7,
        maxTokens:
          typeof node.data.maxTokens === "number" ? node.data.maxTokens : 1024,
        apiKey,
      });
      outputs.set(node.id, { text: result.text });
      return null;
    }

    case "nanoBanana": {
      const prompt = text ?? "";
      const apiKey = deps.resolveKey("gemini");
      if (!apiKey) {
        throw new ToolError({
          code: "byok_key_missing",
          message: `No API key was supplied for provider 'gemini', required by node ${node.id}.`,
          fix: "Pass a Gemini provider key with the request.",
        });
      }
      const result = await deps.generateImage({
        prompt,
        images,
        model: typeof node.data.model === "string" ? node.data.model : "nano-banana-pro",
        apiKey,
        ...(typeof node.data.aspectRatio === "string"
          ? { aspectRatio: node.data.aspectRatio }
          : {}),
        ...(typeof node.data.resolution === "string"
          ? { resolution: node.data.resolution }
          : {}),
      });
      outputs.set(node.id, { image: result.dataUrl });
      const saved = await deps.saveImageAsset({
        dataUrl: result.dataUrl,
        nodeId: node.id,
      });
      return { nodeId: node.id, assetId: saved.assetId, url: saved.url };
    }

    case "output": {
      // Terminal sink: it surfaces upstream media in the UI but produces no new
      // asset. Carry the input forward so a chained output still resolves.
      outputs.set(node.id, {
        ...(images[0] ? { image: images[0] } : {}),
        ...(text !== null ? { text } : {}),
      });
      return null;
    }

    default:
      // Unreachable: planExecution rejects unsupported types up front.
      throw new ToolError({
        code: "unsupported_node",
        message: `Node type '${node.type}' is not supported by the server runner.`,
        fix: "Remove the node or run the workflow in the browser editor.",
      });
  }
}

/**
 * Execute a workflow graph end to end. Never throws for node-level failures:
 * a failed node is recorded, downstream nodes are marked `skipped`, and the run
 * result reports `failed` with the structured error. Only programmer errors
 * escape. Fail-fast validation (`unsupported_node`, cycles, missing keys) is the
 * caller's responsibility via `planExecution` + `assertProviderKeys`.
 */
export async function executeWorkflow(
  graph: WorkflowGraph,
  deps: RunnerDeps,
): Promise<RunResult> {
  const order = planExecution(graph);
  const outputs = new Map<string, NodeOutput>();
  const progress: RunProgress = {
    nodes: order.map<NodeProgress>((node) => ({
      nodeId: node.id,
      type: node.type,
      status: "pending",
    })),
  };
  const progressById = new Map(progress.nodes.map((p) => [p.nodeId, p]));
  const collected: RunOutput[] = [];

  async function emit(): Promise<void> {
    if (deps.onProgress) {
      await deps.onProgress({ nodes: progress.nodes.map((n) => ({ ...n })) });
    }
  }

  let failed: ToolError | Error | null = null;

  for (const node of order) {
    const entry = progressById.get(node.id);
    if (!entry) continue;

    if (failed) {
      entry.status = "skipped";
      continue;
    }

    entry.status = "running";
    await emit();

    try {
      const output = await executeNode(node, graph, deps, outputs);
      if (output) collected.push(output);
      entry.status = "succeeded";
      await emit();
    } catch (error) {
      entry.status = "failed";
      entry.error = error instanceof Error ? error.message : String(error);
      failed = error instanceof Error ? error : new Error(String(error));
      await emit();
    }
  }

  if (failed) {
    return {
      status: "failed",
      progress,
      outputs: collected,
      error: toStructuredError(failed),
    };
  }

  return { status: "succeeded", progress, outputs: collected };
}
