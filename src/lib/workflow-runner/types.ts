import type { StructuredToolError } from "@/lib/agent-tools/errors";

/**
 * A single node in a workflow, reduced to the only fields the server-side
 * runner cares about. The persisted workflow JSON (`WorkflowFile`) carries much
 * more (positions, carousel history, UI collapse state); the runner ignores all
 * of it and works from `type` + `data`.
 */
export interface RunnerNode {
  id: string;
  type: string;
  data: Record<string, unknown>;
}

/** A directed connection from one node's output handle to another's input. */
export interface RunnerEdge {
  id?: string;
  source: string;
  target: string;
  sourceHandle?: string | null;
  targetHandle?: string | null;
}

export interface WorkflowGraph {
  nodes: RunnerNode[];
  edges: RunnerEdge[];
}

/**
 * The node types the server runner can execute today — the honest MVP subset of
 * "pure server round-trips". Everything else fails with `unsupported_node`.
 */
export const SUPPORTED_NODE_TYPES = [
  "prompt",
  "imageInput",
  "llmGenerate",
  "nanoBanana",
  "output",
] as const;

export type SupportedNodeType = (typeof SUPPORTED_NODE_TYPES)[number];

/**
 * The single key-resolution seam. Given a provider id (`gemini`, `google`,
 * `openai`, `anthropic`), return the API key to use, or null/undefined when the
 * caller supplied none.
 *
 * Today the only implementation reads from per-request provider keys (header
 * pass-through / tool input). A later merge replaces the injected function with
 * `resolveInferenceKey` (request header → workspace vault → typed error) without
 * touching the runner — this is the documented BYOK seam.
 */
export type ProviderKeyResolver = (
  provider: string,
) => string | null | undefined;

export interface GenerateImageArgs {
  prompt: string;
  images: string[];
  /** Internal model name, e.g. `nano-banana` / `nano-banana-pro`. */
  model: string;
  apiKey: string;
  aspectRatio?: string;
  resolution?: string;
}

export interface GenerateTextArgs {
  prompt: string;
  images: string[];
  provider: string;
  model: string;
  temperature: number;
  maxTokens: number;
  apiKey: string;
}

export interface SaveImageAssetArgs {
  /** Base64 data URL produced by the image model. */
  dataUrl: string;
  nodeId: string;
}

export interface SavedAsset {
  assetId: string;
  /** A resolvable URL for the asset, when the storage backend can mint one. */
  url: string | null;
}

/**
 * Side-effecting collaborators, injected so the runner stays pure and testable.
 * Production wiring (`defaultRunnerDeps`) points these at the same provider and
 * asset code the HTTP routes use; tests pass fakes and never touch the network.
 */
export interface RunnerDeps {
  resolveKey: ProviderKeyResolver;
  generateImage: (args: GenerateImageArgs) => Promise<{ dataUrl: string }>;
  generateText: (args: GenerateTextArgs) => Promise<{ text: string }>;
  saveImageAsset: (args: SaveImageAssetArgs) => Promise<SavedAsset>;
  /** Resolve an `asset_...` reference on an imageInput node to a data URL. */
  resolveImageRef?: (ref: string) => Promise<string>;
  /** Called after every node status transition so a job row can persist it. */
  onProgress?: (progress: RunProgress) => void | Promise<void>;
}

export type NodeRunStatus =
  | "pending"
  | "running"
  | "succeeded"
  | "failed"
  | "skipped";

export interface NodeProgress {
  nodeId: string;
  type: string;
  status: NodeRunStatus;
  error?: string;
}

export interface RunProgress {
  nodes: NodeProgress[];
}

export interface RunOutput {
  nodeId: string;
  assetId: string;
  url: string | null;
}

export interface RunResult {
  status: "succeeded" | "failed";
  progress: RunProgress;
  outputs: RunOutput[];
  error?: StructuredToolError;
}
