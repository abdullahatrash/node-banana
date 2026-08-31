import { ToolError } from "@/lib/agent-tools/errors";

import {
  SUPPORTED_NODE_TYPES,
  type RunnerEdge,
  type RunnerNode,
  type WorkflowGraph,
} from "./types";

const SUPPORTED = new Set<string>(SUPPORTED_NODE_TYPES);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Reduce a persisted workflow JSON blob to the runner's minimal graph shape.
 * The persisted document is a `WorkflowFile` (`{ version, name, nodes, edges }`)
 * — we validate that surface and keep only `id`/`type`/`data` per node.
 */
export function parseWorkflowGraph(workflowJson: unknown): WorkflowGraph {
  if (
    !isRecord(workflowJson) ||
    !Array.isArray(workflowJson.nodes) ||
    !Array.isArray(workflowJson.edges)
  ) {
    throw new ToolError({
      code: "invalid_input",
      message:
        "The project's workflow JSON is missing or malformed (expected nodes and edges arrays).",
      fix: "Open the project in the editor and save it once to persist a valid workflow, then retry.",
    });
  }

  const nodes: RunnerNode[] = workflowJson.nodes.map((raw) => {
    const node = isRecord(raw) ? raw : {};
    return {
      id: String(node.id ?? ""),
      type: String(node.type ?? ""),
      data: isRecord(node.data) ? node.data : {},
    };
  });

  const edges: RunnerEdge[] = workflowJson.edges.map((raw) => {
    const edge = isRecord(raw) ? raw : {};
    return {
      id: edge.id === undefined ? undefined : String(edge.id),
      source: String(edge.source ?? ""),
      target: String(edge.target ?? ""),
      sourceHandle:
        edge.sourceHandle === undefined || edge.sourceHandle === null
          ? null
          : String(edge.sourceHandle),
      targetHandle:
        edge.targetHandle === undefined || edge.targetHandle === null
          ? null
          : String(edge.targetHandle),
    };
  });

  return { nodes, edges };
}

/**
 * Topologically order the graph so every node runs after its inputs. Fails fast
 * (before any execution) on two conditions the runner cannot honestly handle:
 *  - a node type outside {@link SUPPORTED_NODE_TYPES} → `unsupported_node`
 *  - a dependency cycle → `invalid_input`
 */
export function planExecution(graph: WorkflowGraph): RunnerNode[] {
  const unsupported = graph.nodes.find((node) => !SUPPORTED.has(node.type));
  if (unsupported) {
    throw new ToolError({
      code: "unsupported_node",
      message: `The workflow contains a node type the server runner does not support yet: '${unsupported.type}' (node ${unsupported.id}).`,
      fix: `Remove or replace '${unsupported.type}' nodes. The runner supports: ${SUPPORTED_NODE_TYPES.join(", ")}.`,
    });
  }

  const byId = new Map(graph.nodes.map((node) => [node.id, node]));
  const indegree = new Map<string, number>();
  const dependents = new Map<string, string[]>();

  for (const node of graph.nodes) {
    indegree.set(node.id, 0);
    dependents.set(node.id, []);
  }

  for (const edge of graph.edges) {
    // Ignore edges that dangle outside the node set.
    if (!byId.has(edge.source) || !byId.has(edge.target)) continue;
    indegree.set(edge.target, (indegree.get(edge.target) ?? 0) + 1);
    dependents.get(edge.source)?.push(edge.target);
  }

  // Kahn's algorithm; preserve original node order among ready nodes for
  // deterministic output.
  const ready = graph.nodes
    .filter((node) => (indegree.get(node.id) ?? 0) === 0)
    .map((node) => node.id);
  const ordered: RunnerNode[] = [];

  while (ready.length > 0) {
    const id = ready.shift() as string;
    const node = byId.get(id);
    if (node) ordered.push(node);
    for (const next of dependents.get(id) ?? []) {
      const remaining = (indegree.get(next) ?? 0) - 1;
      indegree.set(next, remaining);
      if (remaining === 0) ready.push(next);
    }
  }

  if (ordered.length !== graph.nodes.length) {
    throw new ToolError({
      code: "invalid_input",
      message: "The workflow contains a cycle and cannot be executed.",
      fix: "Break the cycle so the node graph is a directed acyclic graph, then retry.",
    });
  }

  return ordered;
}
