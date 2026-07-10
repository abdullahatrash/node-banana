"use client";

import { useState, useCallback } from "react";
import { WorkflowFile, useProviderApiKeys } from "@/store/workflowStore";
import { getAllPresets } from "@/lib/quickstart/templates";
import { QuickstartBackButton } from "./QuickstartBackButton";
import { buildGeminiOnlyHeaders } from "@/store/utils/buildApiHeaders";

interface QuickstartTemplatesViewProps {
  onBack: () => void;
  onWorkflowSelected: (workflow: WorkflowFile) => void;
}

export function QuickstartTemplatesView({
  onBack,
  onWorkflowSelected,
}: QuickstartTemplatesViewProps) {
  const [loadingWorkflowId, setLoadingWorkflowId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { geminiApiKey } = useProviderApiKeys();

  const presets = getAllPresets();

  const handlePresetSelect = useCallback(
    async (templateId: string) => {
      setLoadingWorkflowId(templateId);
      setError(null);

      try {
        const response = await fetch("/api/quickstart", {
          method: "POST",
          headers: buildGeminiOnlyHeaders(geminiApiKey),
          body: JSON.stringify({
            templateId,
            contentLevel: "full",
          }),
        });

        const result = await response.json();

        if (!result.success) {
          throw new Error(result.error || "Failed to load template");
        }

        if (result.workflow) {
          onWorkflowSelected(result.workflow);
        }
      } catch (err) {
        console.error("Error loading preset:", err);
        setError(err instanceof Error ? err.message : "Failed to load template");
      } finally {
        setLoadingWorkflowId(null);
      }
    },
    [onWorkflowSelected, geminiApiKey]
  );

  const isLoading = loadingWorkflowId !== null;

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-6 py-4 border-b border-neutral-700 flex items-center gap-4">
        <QuickstartBackButton onClick={onBack} disabled={isLoading} />
        <h2 className="text-lg font-semibold text-neutral-100">
          Workflow Templates
        </h2>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-6 space-y-6">
        {/* Description */}
        <p className="text-sm text-neutral-400">
          Pre-built workflows to help you get started quickly. Select a template to load it into the canvas.
        </p>

        {/* Quick Start Templates */}
        <div className="space-y-3">
          <h3 className="text-xs font-medium text-neutral-400 uppercase tracking-wider">
            Quick Start
          </h3>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {presets.map((preset) => (
              <button
                key={preset.id}
                onClick={() => handlePresetSelect(preset.id)}
                disabled={isLoading}
                className={`
                  group flex items-center gap-2.5 px-3 py-2.5 rounded-lg border transition-all text-start
                  ${
                    loadingWorkflowId === preset.id
                      ? "bg-blue-600/20 border-blue-500/50"
                      : "bg-neutral-800/50 border-neutral-700 hover:border-neutral-600 hover:bg-neutral-800"
                  }
                  ${isLoading && loadingWorkflowId !== preset.id ? "opacity-50" : ""}
                  ${isLoading ? "cursor-not-allowed" : "cursor-pointer"}
                `}
              >
                <div
                  className={`
                    w-8 h-8 rounded-md flex items-center justify-center flex-shrink-0
                    ${
                      loadingWorkflowId === preset.id
                        ? "bg-blue-500/30"
                        : "bg-neutral-700/50 group-hover:bg-neutral-700"
                    }
                  `}
                >
                  {loadingWorkflowId === preset.id ? (
                    <svg
                      className="w-4 h-4 text-blue-400 animate-spin"
                      fill="none"
                      viewBox="0 0 24 24"
                    >
                      <circle
                        className="opacity-25"
                        cx="12"
                        cy="12"
                        r="10"
                        stroke="currentColor"
                        strokeWidth="4"
                      />
                      <path
                        className="opacity-75"
                        fill="currentColor"
                        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                      />
                    </svg>
                  ) : (
                    <svg
                      className="w-4 h-4 text-neutral-400 group-hover:text-neutral-300"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      strokeWidth={1.5}
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d={preset.icon}
                      />
                    </svg>
                  )}
                </div>
                <div className="min-w-0">
                  <div className="text-sm font-medium text-neutral-200 truncate">
                    {preset.name}
                  </div>
                  <div className="text-[10px] text-neutral-500 truncate">
                    {preset.description}
                  </div>
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* Error */}
        {error && (
          <div className="flex items-start gap-2 p-3 rounded-lg bg-red-500/10 border border-red-500/30">
            <svg
              className="w-4 h-4 text-red-400 mt-0.5 flex-shrink-0"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
              />
            </svg>
            <div className="flex-1">
              <p className="text-sm text-red-400">{error}</p>
              <button
                onClick={() => setError(null)}
                className="text-xs text-red-400/70 hover:text-red-400 mt-1"
              >
                Dismiss
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
