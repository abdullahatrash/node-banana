"use client";

import { useCallback, useState, useEffect, useMemo, useRef } from "react";
import { Handle, Position, NodeProps, Node } from "@xyflow/react";
import { BaseNode } from "./BaseNode";
import { useCommentNavigation } from "@/hooks/useCommentNavigation";
import { useWorkflowStore } from "@/store/workflowStore";
import { PromptConstructorNodeData, PromptNodeData } from "@/types";

type PromptConstructorNodeType = Node<PromptConstructorNodeData, "promptConstructor">;

interface AvailableVariable {
  name: string;
  value: string;
  nodeId: string;
}

export function PromptConstructorNode({ id, data, selected }: NodeProps<PromptConstructorNodeType>) {
  const nodeData = data;
  const commentNavigation = useCommentNavigation(id);
  const updateNodeData = useWorkflowStore((state) => state.updateNodeData);
  const edges = useWorkflowStore((state) => state.edges);
  const nodes = useWorkflowStore((state) => state.nodes);

  // Local state for template to prevent cursor jumping
  const [localTemplate, setLocalTemplate] = useState(nodeData.template);
  const [isEditing, setIsEditing] = useState(false);

  // Autocomplete state
  const [showAutocomplete, setShowAutocomplete] = useState(false);
  const [autocompletePosition, setAutocompletePosition] = useState({ top: 0, left: 0 });
  const [autocompleteFilter, setAutocompleteFilter] = useState("");
  const [selectedAutocompleteIndex, setSelectedAutocompleteIndex] = useState(0);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Sync from props when not actively editing
  useEffect(() => {
    if (!isEditing) {
      setLocalTemplate(nodeData.template);
    }
  }, [nodeData.template, isEditing]);

  // Get available variables from connected prompt nodes
  const availableVariables = useMemo((): AvailableVariable[] => {
    const connectedPromptNodes = edges
      .filter((e) => e.target === id && e.targetHandle === "text")
      .map((e) => nodes.find((n) => n.id === e.source))
      .filter((n): n is typeof nodes[0] => n !== undefined && n.type === "prompt");

    const vars: AvailableVariable[] = [];
    connectedPromptNodes.forEach((promptNode) => {
      const promptData = promptNode.data as PromptNodeData;
      if (promptData.variableName) {
        vars.push({
          name: promptData.variableName,
          value: promptData.prompt || "",
          nodeId: promptNode.id,
        });
      }
    });

    return vars;
  }, [edges, nodes, id]);

  // Compute unresolved variables client-side
  const unresolvedVars = useMemo(() => {
    const varPattern = /@(\w+)/g;
    const unresolved: string[] = [];
    const matches = localTemplate.matchAll(varPattern);
    const availableNames = new Set(availableVariables.map(v => v.name));

    for (const match of matches) {
      const varName = match[1];
      if (!availableNames.has(varName) && !unresolved.includes(varName)) {
        unresolved.push(varName);
      }
    }

    return unresolved;
  }, [localTemplate, availableVariables]);

  // Compute resolved text client-side for preview
  const resolvedPreview = useMemo(() => {
    let resolved = localTemplate;
    availableVariables.forEach((v) => {
      resolved = resolved.replace(new RegExp(`@${v.name}`, 'g'), v.value);
    });
    return resolved;
  }, [localTemplate, availableVariables]);

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      const newValue = e.target.value;
      setLocalTemplate(newValue);

      // Check if @ was just typed
      const cursorPos = e.target.selectionStart;
      const textBeforeCursor = newValue.slice(0, cursorPos);
      const match = textBeforeCursor.match(/@(\w*)$/);

      if (match && textareaRef.current) {
        // Show autocomplete
        setAutocompleteFilter(match[1] || "");
        setSelectedAutocompleteIndex(0);

        // Calculate position relative to textarea
        const lineHeight = 20; // Approximate line height
        const lines = textBeforeCursor.split('\n');
        const currentLine = lines.length - 1;
        const top = currentLine * lineHeight + 30; // Offset from top of textarea
        const left = 10;

        setAutocompletePosition({ top, left });
        setShowAutocomplete(true);
      } else {
        setShowAutocomplete(false);
      }
    },
    []
  );

  const handleFocus = useCallback(() => {
    setIsEditing(true);
  }, []);

  const handleBlur = useCallback(() => {
    setIsEditing(false);
    if (localTemplate !== nodeData.template) {
      updateNodeData(id, { template: localTemplate });
    }
    // Close autocomplete on blur
    setTimeout(() => setShowAutocomplete(false), 200);
  }, [id, localTemplate, nodeData.template, updateNodeData]);

  const handleAutocompleteSelect = useCallback((varName: string) => {
    if (!textareaRef.current) return;

    const cursorPos = textareaRef.current.selectionStart;
    const textBeforeCursor = localTemplate.slice(0, cursorPos);
    const textAfterCursor = localTemplate.slice(cursorPos);

    // Find the @ position
    const match = textBeforeCursor.match(/@(\w*)$/);
    if (!match) return;

    const atPosition = cursorPos - match[0].length;
    const newTemplate = localTemplate.slice(0, atPosition) + `@${varName}` + textAfterCursor;

    setLocalTemplate(newTemplate);
    updateNodeData(id, { template: newTemplate });
    setShowAutocomplete(false);

    // Set cursor after inserted variable
    const newCursorPos = atPosition + varName.length + 1;
    setTimeout(() => {
      if (textareaRef.current) {
        textareaRef.current.focus();
        textareaRef.current.setSelectionRange(newCursorPos, newCursorPos);
      }
    }, 0);
  }, [localTemplate, id, updateNodeData]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (!showAutocomplete) return;

    const filteredVars = availableVariables.filter(v =>
      v.name.toLowerCase().includes(autocompleteFilter.toLowerCase())
    );

    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedAutocompleteIndex((prev) => (prev + 1) % filteredVars.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedAutocompleteIndex((prev) => (prev - 1 + filteredVars.length) % filteredVars.length);
    } else if (e.key === "Enter" || e.key === "Tab") {
      if (filteredVars.length > 0) {
        e.preventDefault();
        handleAutocompleteSelect(filteredVars[selectedAutocompleteIndex].name);
      }
    } else if (e.key === "Escape") {
      setShowAutocomplete(false);
    }
  }, [showAutocomplete, availableVariables, autocompleteFilter, selectedAutocompleteIndex, handleAutocompleteSelect]);

  const filteredAutocompleteVars = useMemo(() => {
    return availableVariables.filter(v =>
      v.name.toLowerCase().includes(autocompleteFilter.toLowerCase())
    );
  }, [availableVariables, autocompleteFilter]);

  return (
    <BaseNode
      id={id}
      title="Prompt Constructor"
      customTitle={nodeData.customTitle}
      comment={nodeData.comment}
      onCustomTitleChange={(title) => updateNodeData(id, { customTitle: title || undefined })}
      onCommentChange={(comment) => updateNodeData(id, { comment: comment || undefined })}
      selected={selected}
      commentNavigation={commentNavigation ?? undefined}
    >
      {/* Text input handle */}
      <Handle
        type="target"
        position={Position.Left}
        id="text"
        data-handletype="text"
      />

      <div className="relative flex flex-col gap-2 flex-1">
        {/* Warning badge for unresolved variables */}
        {unresolvedVars.length > 0 && (
          <div className="px-2 py-1 bg-amber-900/30 border border-amber-700/50 rounded text-[10px] text-amber-400">
            <span className="font-semibold">Unresolved:</span> {unresolvedVars.map(v => `@${v}`).join(', ')}
          </div>
        )}

        {/* Template textarea with autocomplete */}
        <div className="relative">
          <textarea
            ref={textareaRef}
            value={localTemplate}
            onChange={handleChange}
            onFocus={handleFocus}
            onBlur={handleBlur}
            onKeyDown={handleKeyDown}
            placeholder="Type @ to insert variables..."
            className="nodrag nopan nowheel w-full min-h-[120px] p-2 text-xs leading-relaxed text-neutral-100 border border-neutral-700 rounded bg-neutral-900/50 resize-none focus:outline-none focus:ring-1 focus:ring-neutral-600 focus:border-neutral-600 placeholder:text-neutral-500"
            title={resolvedPreview ? `Preview: ${resolvedPreview}` : undefined}
          />

          {/* Autocomplete dropdown */}
          {showAutocomplete && filteredAutocompleteVars.length > 0 && (
            <div
              className="absolute z-10 bg-neutral-800 border border-neutral-600 rounded shadow-xl max-h-40 overflow-y-auto"
              style={{
                top: autocompletePosition.top,
                left: autocompletePosition.left,
              }}
            >
              {filteredAutocompleteVars.map((variable, index) => (
                <button
                  key={variable.nodeId}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    handleAutocompleteSelect(variable.name);
                  }}
                  className={`w-full px-3 py-2 text-left text-[11px] flex flex-col gap-0.5 transition-colors ${
                    index === selectedAutocompleteIndex
                      ? "bg-neutral-700 text-neutral-100"
                      : "text-neutral-300 hover:bg-neutral-700"
                  }`}
                >
                  <div className="font-medium text-blue-400">@{variable.name}</div>
                  <div className="text-neutral-500 truncate max-w-[200px]">
                    {variable.value || "(empty)"}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Available variables info */}
        {availableVariables.length > 0 && (
          <div className="text-[10px] text-neutral-500 px-2">
            Available: {availableVariables.map(v => `@${v.name}`).join(', ')}
          </div>
        )}
      </div>

      {/* Text output handle */}
      <Handle
        type="source"
        position={Position.Right}
        id="text"
        data-handletype="text"
      />
    </BaseNode>
  );
}
