"use client";

import { useEffect, useRef, useCallback } from "react";
import { useParams } from "next/navigation";
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
import { useToast } from "@/components/Toast";

/**
 * Unified studio page handling both /studio and /studio/[projectId].
 *
 * Uses an optional catch-all route so router.replace('/studio/wf_123')
 * updates the URL without unmounting — no flicker.
 *
 * Project loading only triggers on direct URL access (refresh, bookmark)
 * when the store doesn't already have the matching workflow loaded.
 */
export default function StudioPage() {
  const params = useParams<{ projectId?: string[] }>();
  const projectId = params.projectId?.[0] ?? null;

  const initializeAutoSave = useWorkflowStore(
    (state) => state.initializeAutoSave
  );
  const cleanupAutoSave = useWorkflowStore((state) => state.cleanupAutoSave);
  const loadWorkflow = useWorkflowStore((state) => state.loadWorkflow);
  const workflowId = useWorkflowStore((state) => state.workflowId);
  const { show: showToast } = useToast();

  // Track whether we've attempted to load this projectId already
  const loadAttemptedRef = useRef<string | null>(null);

  // Load project from URL on direct access (bookmark, refresh, pasted URL).
  // Skipped when the store already has the matching workflow (e.g., after
  // template load or project create, where router.replace just updates URL).
  const loadProjectFromUrl = useCallback(
    async (id: string) => {
      try {
        if (isCloudMode()) {
          const project = await getStudioProject(id);
          if (!project.workflowJson || !isWorkflowFile(project.workflowJson)) {
            showToast("Project has no valid workflow data.", "error");
            return;
          }
          await loadWorkflow(
            project.workflowJson as unknown as WorkflowFile,
            project.sourceDirectoryPath || undefined
          );
        } else {
          const configs = loadSaveConfigs();
          const config = configs[id];
          if (!config) {
            showToast("Project not found.", "error");
            return;
          }
          const response = await fetch(
            `/api/workflow?path=${encodeURIComponent(config.directoryPath)}&name=${encodeURIComponent(config.name || "")}`
          );
          const result = await response.json();
          if (!result.success || !result.workflow) {
            showToast(result.error || "Failed to load workflow.", "error");
            return;
          }
          await loadWorkflow(result.workflow, config.directoryPath);
        }
      } catch (err) {
        showToast(
          err instanceof Error ? err.message : "Failed to load project.",
          "error"
        );
      }
    },
    [loadWorkflow, showToast]
  );

  useEffect(() => {
    if (!projectId) return;
    if (workflowId === projectId) return;
    if (loadAttemptedRef.current === projectId) return;

    loadAttemptedRef.current = projectId;
    loadProjectFromUrl(projectId);
  }, [projectId, workflowId, loadProjectFromUrl]);

  // Auto-save lifecycle
  useEffect(() => {
    initializeAutoSave();
    return () => cleanupAutoSave();
  }, [initializeAutoSave, cleanupAutoSave]);

  // Unsaved changes warning
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (useWorkflowStore.getState().hasUnsavedChanges) {
        e.preventDefault();
      }
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, []);

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
