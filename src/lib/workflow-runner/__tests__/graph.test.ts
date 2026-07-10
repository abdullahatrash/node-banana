import { describe, expect, it } from "vitest";

import { ToolError } from "@/lib/agent-tools/errors";

import { parseWorkflowGraph, planExecution } from "../graph";

describe("parseWorkflowGraph", () => {
  it("extracts nodes and edges from persisted workflow JSON", () => {
    const graph = parseWorkflowGraph({
      version: 1,
      name: "demo",
      nodes: [
        { id: "p1", type: "prompt", data: { prompt: "hi" }, position: { x: 0, y: 0 } },
        { id: "o1", type: "output", data: {}, position: { x: 1, y: 1 } },
      ],
      edges: [{ id: "e1", source: "p1", target: "o1", sourceHandle: "text" }],
    });

    expect(graph.nodes).toHaveLength(2);
    expect(graph.nodes[0]).toEqual({ id: "p1", type: "prompt", data: { prompt: "hi" } });
    expect(graph.edges[0]).toMatchObject({ source: "p1", target: "o1" });
  });

  it("throws invalid_input when the workflow JSON is not a workflow file", () => {
    let error: unknown;
    try {
      parseWorkflowGraph({ foo: "bar" });
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(ToolError);
    expect((error as ToolError).code).toBe("invalid_input");
  });
});

describe("planExecution", () => {
  it("orders nodes so every dependency precedes its dependents", () => {
    const order = planExecution({
      nodes: [
        { id: "o1", type: "output", data: {} },
        { id: "n1", type: "nanoBanana", data: {} },
        { id: "p1", type: "prompt", data: {} },
      ],
      edges: [
        { source: "p1", target: "n1" },
        { source: "n1", target: "o1" },
      ],
    });

    const ids = order.map((n) => n.id);
    expect(ids.indexOf("p1")).toBeLessThan(ids.indexOf("n1"));
    expect(ids.indexOf("n1")).toBeLessThan(ids.indexOf("o1"));
  });

  it("throws unsupported_node listing the offending type", () => {
    let error: unknown;
    try {
      planExecution({
        nodes: [
          { id: "p1", type: "prompt", data: {} },
          { id: "v1", type: "generateVideo", data: {} },
        ],
        edges: [{ source: "p1", target: "v1" }],
      });
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(ToolError);
    expect((error as ToolError).code).toBe("unsupported_node");
    expect((error as ToolError).message).toContain("generateVideo");
  });

  it("throws when the graph contains a cycle", () => {
    let error: unknown;
    try {
      planExecution({
        nodes: [
          { id: "a", type: "prompt", data: {} },
          { id: "b", type: "output", data: {} },
        ],
        edges: [
          { source: "a", target: "b" },
          { source: "b", target: "a" },
        ],
      });
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(ToolError);
    expect((error as ToolError).code).toBe("invalid_input");
  });
});
