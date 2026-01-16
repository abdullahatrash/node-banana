"use client";

import { useEffect, useCallback } from "react";
import { Node, Edge } from "@xyflow/react";
import { WorkflowPreview } from "./WorkflowPreview";

interface WorkflowPreviewModalProps {
  isOpen: boolean;
  onClose: () => void;
  templateName: string;
  workflow: { nodes: Node[]; edges: Edge[] };
}

export function WorkflowPreviewModal({
  isOpen,
  onClose,
  templateName,
  workflow,
}: WorkflowPreviewModalProps) {
  // Handle escape key to close
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    },
    [onClose]
  );

  useEffect(() => {
    if (isOpen) {
      document.addEventListener("keydown", handleKeyDown);
      return () => document.removeEventListener("keydown", handleKeyDown);
    }
  }, [isOpen, handleKeyDown]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      onClick={onClose}
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/70" />

      {/* Modal */}
      <div
        className="relative bg-neutral-900 border border-neutral-700 rounded-xl shadow-2xl w-[90vw] max-w-4xl max-h-[85vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-neutral-700">
          <div>
            <h3 className="text-base font-semibold text-neutral-100">
              {templateName}
            </h3>
            <p className="text-xs text-neutral-500 mt-0.5">
              Workflow structure preview
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-md text-neutral-400 hover:text-neutral-200 hover:bg-neutral-800 transition-colors"
          >
            <svg
              className="w-5 h-5"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>

        {/* Preview Content */}
        <div className="flex-1 min-h-0 p-4">
          <div className="w-full h-[65vh] bg-neutral-950 rounded-lg border border-neutral-800 overflow-hidden">
            <WorkflowPreview workflow={workflow} />
          </div>
        </div>

        {/* Footer hint */}
        <div className="px-5 py-3 border-t border-neutral-700 text-center">
          <p className="text-xs text-neutral-500">
            Press <kbd className="px-1.5 py-0.5 rounded bg-neutral-800 text-neutral-400 font-mono text-[10px]">Esc</kbd> or click outside to close
          </p>
        </div>
      </div>
    </div>
  );
}
