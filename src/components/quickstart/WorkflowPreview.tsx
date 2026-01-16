"use client";

import { useMemo, useCallback } from "react";
import {
  ReactFlow,
  ReactFlowProvider,
  Node,
  Edge,
  useReactFlow,
  NodeProps,
  Handle,
  Position,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

// Node type to color mapping
const NODE_COLORS: Record<string, string> = {
  imageInput: "#22c55e",    // green-500
  annotation: "#eab308",    // yellow-500
  prompt: "#3b82f6",        // blue-500
  nanoBanana: "#f97316",    // orange-500
  generateVideo: "#a855f7", // purple-500
  llmGenerate: "#06b6d4",   // cyan-500
  splitGrid: "#ec4899",     // pink-500
  output: "#6b7280",        // gray-500
};

// Node type to display label mapping
const NODE_LABELS: Record<string, string> = {
  imageInput: "Image Input",
  annotation: "Annotation",
  prompt: "Prompt",
  nanoBanana: "Generate Image",
  generateVideo: "Generate Video",
  llmGenerate: "LLM",
  splitGrid: "Split Grid",
  output: "Output",
};

interface PreviewNodeData extends Record<string, unknown> {
  nodeType: string;
  label?: string;
  model?: string;
}

// Preview node component with outline style and labels
function PreviewNode({ data }: NodeProps) {
  const nodeData = data as PreviewNodeData;
  const nodeType = nodeData?.nodeType || "unknown";
  const color = NODE_COLORS[nodeType] || "#6b7280";
  const label = nodeData?.label || NODE_LABELS[nodeType] || nodeType;
  const model = nodeData?.model;

  // Determine if this is a generate node that should show model
  const isGenerateNode = nodeType === "nanoBanana" || nodeType === "generateVideo";

  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        backgroundColor: "rgba(23, 23, 23, 0.95)",
        border: `2px solid ${color}`,
        borderRadius: 8,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: "8px 12px",
        gap: 4,
      }}
    >
      {/* Node label */}
      <div
        style={{
          fontSize: 11,
          fontWeight: 600,
          color: color,
          textAlign: "center",
          lineHeight: 1.2,
        }}
      >
        {label}
      </div>

      {/* Model name for generate nodes */}
      {isGenerateNode && model && (
        <div
          style={{
            fontSize: 9,
            color: "rgba(255,255,255,0.6)",
            textAlign: "center",
            lineHeight: 1.2,
            maxWidth: "100%",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {model}
        </div>
      )}

      {/* Invisible handles for edge connections */}
      <Handle
        type="target"
        position={Position.Left}
        style={{ opacity: 0, pointerEvents: "none" }}
      />
      <Handle
        type="source"
        position={Position.Right}
        style={{ opacity: 0, pointerEvents: "none" }}
      />
    </div>
  );
}

const previewNodeTypes = {
  preview: PreviewNode,
};

interface WorkflowPreviewProps {
  workflow: {
    nodes: Node[];
    edges: Edge[];
  };
  className?: string;
}

// Helper to extract model name from node data
function getModelName(nodeData: Record<string, unknown>): string | undefined {
  // Check for model field (common in generate nodes)
  if (typeof nodeData?.model === "string") {
    // Format model name to be more readable
    const model = nodeData.model as string;
    // Map internal names to display names
    if (model === "nano-banana") return "Gemini Flash";
    if (model === "nano-banana-pro") return "Gemini Pro";
    // For other models, show shortened version
    if (model.includes("/")) {
      const parts = model.split("/");
      return parts[parts.length - 1];
    }
    return model;
  }
  return undefined;
}

// Inner component that can use useReactFlow
function WorkflowPreviewInner({ workflow, className = "" }: WorkflowPreviewProps) {
  const { fitView } = useReactFlow();

  // Transform workflow nodes to preview nodes with labels
  const previewNodes = useMemo(() => {
    return workflow.nodes.map((node) => {
      const nodeType = node.type || "unknown";
      const nodeData = node.data as Record<string, unknown>;

      return {
        id: node.id,
        type: "preview",
        position: node.position,
        data: {
          nodeType,
          label: NODE_LABELS[nodeType] || nodeType,
          model: getModelName(nodeData),
        } as PreviewNodeData,
        // Use scaled-down versions of the original dimensions
        style: {
          width: ((node.style?.width as number) || 300) * 0.35,
          height: ((node.style?.height as number) || 280) * 0.3,
        },
      };
    });
  }, [workflow.nodes]);

  // Create visible edges with better styling
  const previewEdges = useMemo(() => {
    return workflow.edges.map((edge) => ({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      type: "smoothstep",
      style: {
        stroke: "#525252",
        strokeWidth: 2,
      },
      animated: false,
    }));
  }, [workflow.edges]);

  // Fit view when nodes load
  const onInit = useCallback(() => {
    setTimeout(() => {
      fitView({ padding: 0.2, duration: 0 });
    }, 50);
  }, [fitView]);

  return (
    <div className={`w-full h-full ${className}`}>
      <ReactFlow
        nodes={previewNodes}
        edges={previewEdges}
        nodeTypes={previewNodeTypes}
        onInit={onInit}
        // Non-interactive mode
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={false}
        panOnDrag={false}
        zoomOnScroll={false}
        zoomOnPinch={false}
        zoomOnDoubleClick={false}
        preventScrolling={true}
        // Fit the preview to container
        fitView={true}
        fitViewOptions={{ padding: 0.2 }}
        // Hide attribution
        proOptions={{ hideAttribution: true }}
        // Styling
        className="bg-transparent"
        defaultEdgeOptions={{
          type: "smoothstep",
          animated: false,
        }}
      />
    </div>
  );
}

// Wrap with ReactFlowProvider for standalone usage
export function WorkflowPreview(props: WorkflowPreviewProps) {
  return (
    <ReactFlowProvider>
      <WorkflowPreviewInner {...props} />
    </ReactFlowProvider>
  );
}
