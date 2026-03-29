"use client";

import { ChangeEvent, useEffect, useMemo, useRef, useState } from "react";
import type { WorkflowFile } from "@/store/workflowStore";
import {
  getActiveWorkspaceId,
  isWorkflowFile,
  setActiveWorkspaceId,
} from "@/lib/studio/client";
import {
  fetchWorkspaces,
  fetchProjects,
  fetchProjectDetail,
  deleteProject as deleteProjectAction,
  deleteAsset as deleteAssetAction,
  type SAWorkspace as StudioWorkspace,
  type SAProjectSummary as StudioProjectSummary,
  type SAProjectDetail as StudioProjectDetail,
  type SAAsset as StudioAsset,
} from "@/app/studio/actions";

interface ProjectBrowserModalProps {
  isOpen: boolean;
  onClose: () => void;
  onLoadWorkflow: (workflow: WorkflowFile, workflowPath?: string) => Promise<void> | void;
}

type ActiveTab = "projects" | "json";

function formatTimestamp(value: string | null): string {
  if (!value) return "Unknown";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "Unknown";
  return parsed.toLocaleString();
}

function formatBytes(value: number | null): string {
  if (!value || value <= 0) return "Unknown size";
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  if (value < 1024 * 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(1)} MB`;
  return `${(value / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

export function ProjectBrowserModal({
  isOpen,
  onClose,
  onLoadWorkflow,
}: ProjectBrowserModalProps) {
  const [activeTab, setActiveTab] = useState<ActiveTab>("projects");
  const [projects, setProjects] = useState<StudioProjectSummary[]>([]);
  const [workspaces, setWorkspaces] = useState<StudioWorkspace[]>([]);
  const [activeWorkspaceId, setActiveWorkspaceIdState] = useState<string | null>(null);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [selectedProject, setSelectedProject] = useState<StudioProjectDetail | null>(null);
  const [assets, setAssets] = useState<StudioAsset[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isLoadingProjects, setIsLoadingProjects] = useState(false);
  const [isLoadingWorkspaces, setIsLoadingWorkspaces] = useState(false);
  const [isLoadingProjectDetail, setIsLoadingProjectDetail] = useState(false);
  const [isLoadingJson, setIsLoadingJson] = useState(false);
  const [isDeletingProjectId, setIsDeletingProjectId] = useState<string | null>(null);
  const [isDeletingAssetId, setIsDeletingAssetId] = useState<string | null>(null);
  const [isOpeningProject, setIsOpeningProject] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const selectionRequestIdRef = useRef(0);

  const hasProjects = projects.length > 0;
  const canOpenSelectedProject = Boolean(selectedProject?.workflowJson) && !isOpeningProject;

  const selectedProjectMeta = useMemo(() => {
    if (!selectedProject) return null;
    return {
      updated: formatTimestamp(selectedProject.updatedAt),
      created: formatTimestamp(selectedProject.createdAt),
    };
  }, [selectedProject]);

  const loadWorkspaces = async (): Promise<string | null> => {
    setIsLoadingWorkspaces(true);
    try {
      const nextWorkspaces = await fetchWorkspaces();
      setWorkspaces(nextWorkspaces);

      if (nextWorkspaces.length === 0) {
        setActiveWorkspaceIdState(null);
        setActiveWorkspaceId(null);
        return null;
      }

      const savedWorkspaceId = getActiveWorkspaceId();
      const resolvedWorkspaceId =
        savedWorkspaceId && nextWorkspaces.some((ws) => ws.id === savedWorkspaceId)
          ? savedWorkspaceId
          : nextWorkspaces[0].id;

      setActiveWorkspaceIdState(resolvedWorkspaceId);
      setActiveWorkspaceId(resolvedWorkspaceId);
      return resolvedWorkspaceId;
    } finally {
      setIsLoadingWorkspaces(false);
    }
  };

  const loadProjects = async () => {
    setIsLoadingProjects(true);
    setError(null);
    try {
      const wsId = getActiveWorkspaceId();
      if (!wsId) throw new Error("No active workspace.");
      const list = await fetchProjects(wsId);
      setProjects(list);

      const nextSelectedId =
        selectedProjectId && list.some((project) => project.id === selectedProjectId)
          ? selectedProjectId
          : list[0]?.id || null;

      if (!nextSelectedId) {
        setSelectedProjectId(null);
        setSelectedProject(null);
        setAssets([]);
        return;
      }

      await loadProjectDetail(nextSelectedId);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Failed to load projects.");
    } finally {
      setIsLoadingProjects(false);
    }
  };

  const loadProjectDetail = async (projectId: string) => {
    setSelectedProjectId(projectId);
    setIsLoadingProjectDetail(true);
    setError(null);
    const requestId = ++selectionRequestIdRef.current;

    try {
      const wsId = getActiveWorkspaceId();
      if (!wsId) throw new Error("No active workspace.");
      const { project, assets: projectAssets } = await fetchProjectDetail(wsId, projectId);

      if (requestId !== selectionRequestIdRef.current) return;
      setSelectedProject(project);
      setAssets(projectAssets);
    } catch (loadError) {
      if (requestId !== selectionRequestIdRef.current) return;
      setSelectedProject(null);
      setAssets([]);
      setError(loadError instanceof Error ? loadError.message : "Failed to load project detail.");
    } finally {
      if (requestId === selectionRequestIdRef.current) {
        setIsLoadingProjectDetail(false);
      }
    }
  };

  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;

    setActiveTab("projects");
    setSelectedProjectId(null);
    setSelectedProject(null);
    setAssets([]);
    setError(null);
    setIsLoadingProjects(true);

    void (async () => {
      try {
        const resolvedWorkspaceId = await loadWorkspaces();
        if (cancelled) return;
        if (!resolvedWorkspaceId) {
          setProjects([]);
          setSelectedProjectId(null);
          setSelectedProject(null);
          setAssets([]);
          return;
        }
        await loadProjects();
      } catch (loadError) {
        if (cancelled) return;
        setError(loadError instanceof Error ? loadError.message : "Failed to load workspaces.");
      }
    })();

    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  const handleWorkspaceChange = async (
    event: ChangeEvent<HTMLSelectElement>,
  ) => {
    const workspaceId = event.target.value;
    setActiveWorkspaceId(workspaceId);
    setActiveWorkspaceIdState(workspaceId);
    setProjects([]);
    setSelectedProjectId(null);
    setSelectedProject(null);
    setAssets([]);
    await loadProjects();
  };

  const handleOpenSelectedProject = async () => {
    if (!selectedProject?.workflowJson) return;

    if (!isWorkflowFile(selectedProject.workflowJson)) {
      setError("Selected project does not contain a valid workflow JSON.");
      return;
    }

    setIsOpeningProject(true);
    setError(null);
    try {
      const workflow = { ...selectedProject.workflowJson } as WorkflowFile;
      await onLoadWorkflow(workflow, selectedProject.sourceDirectoryPath || undefined);
      onClose();
    } catch (openError) {
      setError(openError instanceof Error ? openError.message : "Failed to open selected project.");
    } finally {
      setIsOpeningProject(false);
    }
  };

  const handleDeleteProject = async (projectId: string) => {
    const target = projects.find((project) => project.id === projectId);
    const projectName = target?.name || "this project";
    const confirmed = window.confirm(`Delete ${projectName}? This can be restored later.`);
    if (!confirmed) return;

    const previousProjects = projects;
    const previousSelectedProject = selectedProject;
    const previousSelectedProjectId = selectedProjectId;
    const previousAssets = assets;

    setProjects((current) => current.filter((project) => project.id !== projectId));
    if (selectedProjectId === projectId) {
      setSelectedProjectId(null);
      setSelectedProject(null);
      setAssets([]);
    }

    setIsDeletingProjectId(projectId);
    setError(null);

    try {
      const wsId = getActiveWorkspaceId();
      if (!wsId) throw new Error("No active workspace.");
      await deleteProjectAction(wsId, projectId);

      if (selectedProjectId === projectId) {
        const remainingProjects = previousProjects.filter((project) => project.id !== projectId);
        if (remainingProjects.length > 0) {
          await loadProjectDetail(remainingProjects[0].id);
        }
      }
    } catch (deleteError) {
      setProjects(previousProjects);
      setSelectedProject(previousSelectedProject);
      setSelectedProjectId(previousSelectedProjectId);
      setAssets(previousAssets);
      setError(deleteError instanceof Error ? deleteError.message : "Failed to delete project.");
    } finally {
      setIsDeletingProjectId(null);
    }
  };

  const handleDeleteAsset = async (assetId: string) => {
    const confirmed = window.confirm("Delete this asset metadata from the project?");
    if (!confirmed) return;

    const previousAssets = assets;
    setAssets((current) => current.filter((asset) => asset.id !== assetId));
    setIsDeletingAssetId(assetId);
    setError(null);

    try {
      await deleteAssetAction(assetId);
    } catch (deleteError) {
      setAssets(previousAssets);
      setError(deleteError instanceof Error ? deleteError.message : "Failed to delete asset.");
    } finally {
      setIsDeletingAssetId(null);
    }
  };

  const handleJsonFileSelected = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setIsLoadingJson(true);
    setError(null);

    try {
      const text = await file.text();
      const payload = JSON.parse(text) as unknown;
      if (!isWorkflowFile(payload)) {
        setError("Invalid workflow file format.");
        return;
      }
      await onLoadWorkflow(payload);
      onClose();
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Failed to parse workflow file.");
    } finally {
      event.target.value = "";
      setIsLoadingJson(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-[120] flex items-center justify-center bg-black/60"
      onClick={onClose}
    >
      <div
        className="w-full max-w-5xl mx-4 bg-neutral-900 border border-neutral-700 rounded-xl shadow-2xl overflow-hidden"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="px-4 py-3 border-b border-neutral-800 flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold text-neutral-100">Open Project</h2>
            <p className="text-xs text-neutral-400">
              Open from Studio projects or import a JSON workflow file.
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-neutral-400 hover:text-neutral-200 hover:bg-neutral-800 rounded transition-colors"
            title="Close"
          >
            ✕
          </button>
        </div>

        <div className="px-4 pt-3">
          <div className="flex items-center justify-between gap-3">
            <div className="inline-flex rounded-lg bg-neutral-800 p-1">
              <button
                onClick={() => setActiveTab("projects")}
                className={`px-3 py-1.5 text-xs rounded-md transition-colors ${
                  activeTab === "projects"
                    ? "bg-neutral-700 text-neutral-100"
                    : "text-neutral-400 hover:text-neutral-200"
                }`}
              >
                Studio Projects
              </button>
              <button
                onClick={() => setActiveTab("json")}
                className={`px-3 py-1.5 text-xs rounded-md transition-colors ${
                  activeTab === "json"
                    ? "bg-neutral-700 text-neutral-100"
                    : "text-neutral-400 hover:text-neutral-200"
                }`}
              >
                JSON File
              </button>
            </div>
            <label className="flex items-center gap-2 text-xs text-neutral-400">
              Workspace
              <select
                value={activeWorkspaceId || ""}
                onChange={(event) => void handleWorkspaceChange(event)}
                disabled={isLoadingWorkspaces || workspaces.length === 0}
                data-testid="workspace-select"
                className="bg-neutral-800 border border-neutral-700 text-neutral-100 rounded px-2 py-1"
              >
                {workspaces.length === 0 ? (
                  <option value="">No workspace</option>
                ) : (
                  workspaces.map((workspace) => (
                    <option key={workspace.id} value={workspace.id}>
                      {workspace.name} ({workspace.role})
                    </option>
                  ))
                )}
              </select>
            </label>
          </div>
        </div>

        {error && (
          <div className="mx-4 mt-3 px-3 py-2 rounded-md bg-red-500/10 border border-red-500/30 text-xs text-red-300">
            {error}
          </div>
        )}

        {activeTab === "projects" ? (
          <div className="p-4 grid grid-cols-1 lg:grid-cols-3 gap-4 min-h-[420px]">
            <section className="lg:col-span-1 border border-neutral-800 rounded-lg overflow-hidden">
              <div className="px-3 py-2 border-b border-neutral-800 flex items-center justify-between">
                <span className="text-xs uppercase tracking-wide text-neutral-400">Projects</span>
                <button
                  onClick={() => void loadProjects()}
                  className="text-xs text-neutral-300 hover:text-neutral-100"
                  disabled={isLoadingProjects}
                >
                  {isLoadingProjects ? "Refreshing..." : "Refresh"}
                </button>
              </div>
              <div className="max-h-[350px] overflow-y-auto">
                {isLoadingProjects ? (
                  <p className="px-3 py-4 text-sm text-neutral-400">Loading projects...</p>
                ) : !hasProjects ? (
                  <p className="px-3 py-4 text-sm text-neutral-400">No projects found yet.</p>
                ) : (
                  projects.map((project) => (
                    <button
                      key={project.id}
                      onClick={() => void loadProjectDetail(project.id)}
                      className={`w-full text-start px-3 py-2 border-b border-neutral-800 hover:bg-neutral-800/60 transition-colors ${
                        selectedProjectId === project.id ? "bg-neutral-800/80" : ""
                      }`}
                    >
                      <p className="text-sm text-neutral-100 truncate">{project.name}</p>
                      <p className="text-xs text-neutral-400 truncate">
                        Updated {formatTimestamp(project.updatedAt)}
                      </p>
                    </button>
                  ))
                )}
              </div>
            </section>

            <section className="lg:col-span-2 border border-neutral-800 rounded-lg p-3 flex flex-col">
              {isLoadingProjectDetail ? (
                <p className="text-sm text-neutral-400">Loading project details...</p>
              ) : !selectedProject ? (
                <p className="text-sm text-neutral-400">Select a project to view details.</p>
              ) : (
                <>
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h3 className="text-sm font-semibold text-neutral-100">{selectedProject.name}</h3>
                      <p className="text-xs text-neutral-400">
                        Created {selectedProjectMeta?.created} · Updated {selectedProjectMeta?.updated}
                      </p>
                      {selectedProject.sourceDirectoryPath && (
                        <p className="text-xs text-neutral-500 mt-1 truncate">
                          Path: {selectedProject.sourceDirectoryPath}
                        </p>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => void handleDeleteProject(selectedProject.id)}
                        disabled={isDeletingProjectId === selectedProject.id}
                        data-testid="delete-project-button"
                        className="px-2.5 py-1.5 text-xs rounded border border-red-500/40 text-red-300 hover:bg-red-500/10 disabled:opacity-60"
                      >
                        {isDeletingProjectId === selectedProject.id ? "Deleting..." : "Delete"}
                      </button>
                      <button
                        onClick={() => void handleOpenSelectedProject()}
                        disabled={!canOpenSelectedProject}
                        data-testid="open-project-button"
                        className="px-3 py-1.5 text-xs rounded bg-blue-600 text-white hover:bg-blue-500 disabled:opacity-50"
                      >
                        {isOpeningProject ? "Opening..." : "Open Project"}
                      </button>
                    </div>
                  </div>

                  <div className="mt-4">
                    <p className="text-xs uppercase tracking-wide text-neutral-400 mb-2">Assets</p>
                    <div className="border border-neutral-800 rounded max-h-[255px] overflow-y-auto">
                      {assets.length === 0 ? (
                        <p className="px-3 py-3 text-sm text-neutral-400">
                          No assets recorded for this project.
                        </p>
                      ) : (
                        assets.map((asset) => (
                          <div
                            key={asset.id}
                            className="px-3 py-2 border-b border-neutral-800 last:border-b-0 flex items-center justify-between gap-2"
                          >
                            <div className="min-w-0">
                              <p className="text-sm text-neutral-200 truncate">
                                {asset.type || "asset"} · {formatBytes(asset.sizeBytes)}
                              </p>
                              <p className="text-xs text-neutral-500 truncate">
                                {asset.storageProvider || "unknown"}: {asset.storageKey || "missing key"}
                              </p>
                            </div>
                            <button
                              onClick={() => void handleDeleteAsset(asset.id)}
                              disabled={isDeletingAssetId === asset.id}
                              data-testid={`delete-asset-${asset.id}`}
                              className="px-2 py-1 text-xs rounded border border-red-500/40 text-red-300 hover:bg-red-500/10 disabled:opacity-60"
                            >
                              {isDeletingAssetId === asset.id ? "Deleting..." : "Delete"}
                            </button>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                </>
              )}
            </section>
          </div>
        ) : (
          <div className="p-4 min-h-[420px]">
            <div className="max-w-xl border border-neutral-800 rounded-lg p-4">
              <h3 className="text-sm font-semibold text-neutral-100">Import JSON Workflow</h3>
              <p className="text-sm text-neutral-400 mt-1">
                Use this fallback to load workflow files from disk.
              </p>
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={isLoadingJson}
                className="mt-4 px-3 py-2 text-sm rounded bg-neutral-700 text-neutral-100 hover:bg-neutral-600 disabled:opacity-60"
              >
                {isLoadingJson ? "Loading..." : "Choose JSON File"}
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept=".json"
                onChange={handleJsonFileSelected}
                className="hidden"
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
