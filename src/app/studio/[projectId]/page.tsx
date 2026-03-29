"use client";

import { use, useEffect, useState } from "react";
import { ReactFlowProvider } from "@xyflow/react";
import { Header } from "@/components/Header";
import { WorkflowCanvas } from "@/components/WorkflowCanvas";
import { FloatingActionBar } from "@/components/FloatingActionBar";
import { AnnotationModal } from "@/components/AnnotationModal";
import { useWorkflowStore } from "@/store/workflowStore";
import type { WorkflowFile } from "@/store/workflowStore";
import { getStudioProject, isWorkflowFile } from "@/lib/studio/client";
import { loadSaveConfigs } from "@/store/utils/localStorage";
import { isCloudMode } from "@/lib/storage";

export default function StudioProjectPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = use(params);

  const initializeAutoSave = useWorkflowStore(
    (state) => state.initializeAutoSave
  );
  const cleanupAutoSave = useWorkflowStore((state) => state.cleanupAutoSave);
  const loadWorkflow = useWorkflowStore((state) => state.loadWorkflow);
  const workflowId = useWorkflowStore((state) => state.workflowId);

  const [loadError, setLoadError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Load project from URL param on mount (only if not already loaded)
  useEffect(() => {
    if (workflowId === projectId) {
      setIsLoading(false);
      return;
    }

    let cancelled = false;

    async function loadProject() {
      setIsLoading(true);
      setLoadError(null);

      try {
        if (isCloudMode()) {
          const project = await getStudioProject(projectId);
          if (cancelled) return;

          if (!project.workflowJson || !isWorkflowFile(project.workflowJson)) {
            setLoadError("Project has no valid workflow data.");
            setIsLoading(false);
            return;
          }

          await loadWorkflow(
            project.workflowJson as unknown as WorkflowFile,
            project.sourceDirectoryPath || undefined
          );
        } else {
          // Local mode: look up in localStorage configs, then load from filesystem
          const configs = loadSaveConfigs();
          const config = configs[projectId];

          if (!config) {
            setLoadError("Project not found in local storage.");
            setIsLoading(false);
            return;
          }

          const response = await fetch(
            `/api/workflow?path=${encodeURIComponent(config.directoryPath)}&name=${encodeURIComponent(config.name || "")}`
          );
          const result = await response.json();
          if (cancelled) return;

          if (!result.success || !result.workflow) {
            setLoadError(result.error || "Failed to load workflow file.");
            setIsLoading(false);
            return;
          }

          await loadWorkflow(result.workflow, config.directoryPath);
        }

        if (!cancelled) {
          setIsLoading(false);
        }
      } catch (err) {
        if (!cancelled) {
          setLoadError(
            err instanceof Error ? err.message : "Failed to load project."
          );
          setIsLoading(false);
        }
      }
    }

    loadProject();
    return () => { cancelled = true; };
  }, [projectId, workflowId, loadWorkflow]);

  useEffect(() => {
    initializeAutoSave();
    return () => cleanupAutoSave();
  }, [initializeAutoSave, cleanupAutoSave]);

  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (useWorkflowStore.getState().hasUnsavedChanges) {
        e.preventDefault();
      }
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, []);

  if (isLoading) {
    return (
      <div className="h-screen flex items-center justify-center bg-neutral-900 text-neutral-400">
        <div className="flex flex-col items-center gap-3">
          <div className="w-6 h-6 border-2 border-neutral-600 border-t-neutral-300 rounded-full animate-spin" />
          <span className="text-sm">Loading project...</span>
        </div>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="h-screen flex items-center justify-center bg-neutral-900 text-neutral-400">
        <div className="flex flex-col items-center gap-3 max-w-md text-center">
          <span className="text-red-400 text-sm">{loadError}</span>
          <a
            href="/studio"
            className="text-sm text-blue-400 hover:text-blue-300 underline"
          >
            Go to Studio
          </a>
        </div>
      </div>
    );
  }

  return (
    <ReactFlowProvider>
      <div className="h-screen flex flex-col">
        <Header />
        <WorkflowCanvas />
        <FloatingActionBar />
        <AnnotationModal />
      </div>
    </ReactFlowProvider>
  );
}
