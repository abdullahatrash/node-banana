"use client";

import { useEffect, useRef } from "react";
import { ReactFlowProvider } from "@xyflow/react";
import { Header } from "@/components/Header";
import { WorkflowCanvas } from "@/components/WorkflowCanvas";
import { FloatingActionBar } from "@/components/FloatingActionBar";
import { AnnotationModal } from "@/components/AnnotationModal";
import { useWorkflowStore } from "@/store/workflowStore";
import type { WorkflowFile } from "@/store/workflowStore";
import { isWorkflowFile } from "@/lib/studio/client";
import { useToast } from "@/components/Toast";
import type { InitialProjectData } from "./page";

interface StudioClientProps {
  projectId: string | null;
  initialProject: InitialProjectData | null;
  loadError: string | null;
}

/**
 * Client wrapper for the studio canvas.
 *
 * Receives server-fetched project data as props (no useEffect for data fetching).
 * Hydrates the Zustand store once when initial data is provided.
 */
export function StudioClient({
  projectId,
  initialProject,
  loadError,
}: StudioClientProps) {
  const initializeAutoSave = useWorkflowStore(
    (state) => state.initializeAutoSave
  );
  const cleanupAutoSave = useWorkflowStore((state) => state.cleanupAutoSave);
  const loadWorkflow = useWorkflowStore((state) => state.loadWorkflow);
  const workflowId = useWorkflowStore((state) => state.workflowId);
  const { show: showToast } = useToast();

  // Track whether we've hydrated the store for this project
  const hydratedRef = useRef<string | null>(null);

  // Hydrate the Zustand store with server-fetched project data (once)
  useEffect(() => {
    if (!projectId || !initialProject) return;
    if (workflowId === projectId) return;
    if (hydratedRef.current === projectId) return;

    hydratedRef.current = projectId;

    if (
      initialProject.workflowJson &&
      isWorkflowFile(initialProject.workflowJson)
    ) {
      loadWorkflow(
        initialProject.workflowJson as unknown as WorkflowFile,
        initialProject.sourceDirectoryPath || undefined
      );
    }
  }, [projectId, initialProject, workflowId, loadWorkflow]);

  // Show server-side load error via toast
  useEffect(() => {
    if (loadError) {
      showToast(loadError, "error");
    }
  }, [loadError, showToast]);

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
