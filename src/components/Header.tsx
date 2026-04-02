"use client";

import Link from "next/link";
import { useRouter, usePathname } from "next/navigation";
import { useState, useMemo, useCallback, useRef, useEffect } from "react";
import { useIsMobile } from "@/hooks/use-mobile";
import { useWorkflowStore, WorkflowFile } from "@/store/workflowStore";
import { useShallow } from "zustand/shallow";
import { authClient } from "@/lib/auth/client";
import { setActiveWorkspaceId } from "@/lib/studio/client";
import { ProjectSetupModal } from "./ProjectSetupModal";
import { ProjectBrowserModal } from "./ProjectBrowserModal";
import { CostIndicator } from "./CostIndicator";
import { KeyboardShortcutsDialog } from "./KeyboardShortcutsDialog";
import { LanguageSwitcher } from "./LanguageSwitcher";
import { isCloudMode } from "@/lib/storage";
import { AppSwitcher } from "./AppSwitcher";

function CommentsNavigationIcon() {
  // Subscribe to nodes so we re-render when comments change
  const nodes = useWorkflowStore((state) => state.nodes);
  const getNodesWithComments = useWorkflowStore((state) => state.getNodesWithComments);
  const viewedCommentNodeIds = useWorkflowStore((state) => state.viewedCommentNodeIds);
  const markCommentViewed = useWorkflowStore((state) => state.markCommentViewed);
  const setNavigationTarget = useWorkflowStore((state) => state.setNavigationTarget);

  // Recalculate when nodes change (nodes in dependency triggers re-render)
  const nodesWithComments = useMemo(() => getNodesWithComments(), [getNodesWithComments, nodes]);
  const unviewedCount = useMemo(() => {
    return nodesWithComments.filter((node) => !viewedCommentNodeIds.has(node.id)).length;
  }, [nodesWithComments, viewedCommentNodeIds]);
  const totalCount = nodesWithComments.length;

  const handleClick = useCallback(() => {
    if (totalCount === 0) return;

    // Find first unviewed comment, or first comment if all viewed
    const targetNode = nodesWithComments.find((node) => !viewedCommentNodeIds.has(node.id)) || nodesWithComments[0];
    if (targetNode) {
      markCommentViewed(targetNode.id);
      setNavigationTarget(targetNode.id);
    }
  }, [totalCount, nodesWithComments, viewedCommentNodeIds, markCommentViewed, setNavigationTarget]);

  // Don't render if no comments
  if (totalCount === 0) {
    return null;
  }

  const displayCount = unviewedCount > 9 ? "9+" : unviewedCount.toString();

  return (
    <button
      onClick={handleClick}
      className="relative p-1.5 text-neutral-400 hover:text-neutral-200 hover:bg-neutral-800 rounded transition-colors"
      title={`${unviewedCount} unviewed comment${unviewedCount !== 1 ? 's' : ''} (${totalCount} total)`}
    >
      <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
        <path fillRule="evenodd" d="M4.848 2.771A49.144 49.144 0 0112 2.25c2.43 0 4.817.178 7.152.52 1.978.292 3.348 2.024 3.348 3.97v6.02c0 1.946-1.37 3.678-3.348 3.97a48.901 48.901 0 01-3.476.383.39.39 0 00-.297.17l-2.755 4.133a.75.75 0 01-1.248 0l-2.755-4.133a.39.39 0 00-.297-.17 48.9 48.9 0 01-3.476-.384c-1.978-.29-3.348-2.024-3.348-3.97V6.741c0-1.946 1.37-3.68 3.348-3.97z" clipRule="evenodd" />
      </svg>
      {unviewedCount > 0 && (
        <span className="absolute -top-0.5 -end-0.5 min-w-[14px] h-[14px] flex items-center justify-center text-[9px] font-bold text-white bg-blue-500 rounded-full px-0.5">
          {displayCount}
        </span>
      )}
    </button>
  );
}

export function Header() {
  const router = useRouter();
  const pathname = usePathname();
  const isSimpleMode = pathname?.startsWith("/studio/simple");
  const { data: session } = authClient.useSession();
  const {
    workflowName,
    workflowId,
    saveDirectoryPath,
    hasUnsavedChanges,
    lastSavedAt,
    isSaving,
    setWorkflowMetadata,
    saveToFile,
    loadWorkflow,
    clearWorkflow,
    previousWorkflowSnapshot,
    revertToSnapshot,
    shortcutsDialogOpen,
    setShortcutsDialogOpen,
    setShowQuickstart,
  } = useWorkflowStore(useShallow((state) => ({
    workflowName: state.workflowName,
    workflowId: state.workflowId,
    saveDirectoryPath: state.saveDirectoryPath,
    hasUnsavedChanges: state.hasUnsavedChanges,
    lastSavedAt: state.lastSavedAt,
    isSaving: state.isSaving,
    setWorkflowMetadata: state.setWorkflowMetadata,
    saveToFile: state.saveToFile,
    loadWorkflow: state.loadWorkflow,
    clearWorkflow: state.clearWorkflow,
    previousWorkflowSnapshot: state.previousWorkflowSnapshot,
    revertToSnapshot: state.revertToSnapshot,
    shortcutsDialogOpen: state.shortcutsDialogOpen,
    setShortcutsDialogOpen: state.setShortcutsDialogOpen,
    setShowQuickstart: state.setShowQuickstart,
  })));

  const [showProjectModal, setShowProjectModal] = useState(false);
  const [showProjectBrowserModal, setShowProjectBrowserModal] = useState(false);
  const [projectModalMode, setProjectModalMode] = useState<"new" | "settings">("new");
  const [isSigningOut, setIsSigningOut] = useState(false);

  const isMobile = useIsMobile();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const mobileMenuRef = useRef<HTMLDivElement>(null);

  const isProjectConfigured = !!workflowName;
  const canSave = !!(workflowId && workflowName && (isCloudMode() || saveDirectoryPath));

  const formatTime = (timestamp: number) => {
    return new Date(timestamp).toLocaleTimeString([], {
      hour: "numeric",
      minute: "2-digit",
    });
  };

  const handleNewProject = () => {
    setProjectModalMode("new");
    setShowProjectModal(true);
  };

  const handleOpenSettings = () => {
    setProjectModalMode("settings");
    setShowProjectModal(true);
  };

  const handleOpenFile = () => {
    setShowProjectBrowserModal(true);
  };

  const handleCloseProject = () => {
    if (hasUnsavedChanges) {
      const confirmed = window.confirm("You have unsaved changes. Close project anyway?");
      if (!confirmed) return;
    }
    clearWorkflow();
    router.replace("/studio");
  };

  const handleProjectSave = async (id: string, name: string, path: string | null) => {
    setWorkflowMetadata(id, name, path); // generationsPath is auto-derived
    setShowProjectModal(false);
    router.replace(`/studio/${encodeURIComponent(id)}`);
    // Small delay to let state update
    setTimeout(() => {
      saveToFile().catch((error) => {
        console.error("Failed to save project:", error);
        alert("Failed to save project. Please try again.");
      });
    }, 50);
  };

  const handleOpenDirectory = async () => {
    if (!saveDirectoryPath) return;

    try {
      const response = await fetch("/api/open-directory", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ path: saveDirectoryPath }),
      });

      const result = await response.json();

      if (!response.ok || !result.success) {
        console.error("Failed to open directory:", result.error);
        alert(`Failed to open project folder: ${result.error || "Unknown error"}`);
        return;
      }
    } catch (error) {
      console.error("Failed to open directory:", error);
      alert("Failed to open project folder. Please try again.");
    }
  };

  const handleSignOut = async () => {
    setIsSigningOut(true);
    try {
      const result = await authClient.signOut();
      const signOutError =
        result &&
        typeof result === "object" &&
        "error" in result
          ? (result as { error?: unknown }).error
          : null;
      if (signOutError) {
        throw signOutError;
      }

      // Prevent stale workspace context from leaking across user sessions.
      setActiveWorkspaceId(null);
      router.replace("/");
    } catch (error) {
      console.error("Failed to sign out:", error);
      alert("Failed to sign out. Please try again.");
    } finally {
      setIsSigningOut(false);
    }
  };

  const sessionLabel =
    (typeof session?.user?.name === "string" && session.user.name.trim()) ||
    (typeof session?.user?.email === "string" && session.user.email.trim()) ||
    "Signed in";

  const handleRevertAIChanges = useCallback(() => {
    const confirmed = window.confirm(
      "Are you sure? This will restore your previous workflow."
    );
    if (confirmed) {
      revertToSnapshot();
    }
  }, [revertToSnapshot]);

  // Close mobile menu on click outside
  useEffect(() => {
    if (!mobileMenuOpen) return;
    function handleClickOutside(e: MouseEvent) {
      if (mobileMenuRef.current && !mobileMenuRef.current.contains(e.target as Node)) {
        setMobileMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [mobileMenuOpen]);

  const settingsButtons = (
    <div className="flex items-center gap-0.5 ms-1 ps-1 border-s border-neutral-700/50">
      <button
        onClick={handleOpenSettings}
        className="p-1.5 text-neutral-400 hover:text-neutral-200 hover:bg-neutral-800 rounded transition-colors"
        title="Project settings"
      >
        <svg
          className="w-4 h-4"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
          />
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
          />
        </svg>
      </button>
    </div>
  );

  return (
    <>
      <ProjectSetupModal
        isOpen={showProjectModal}
        onClose={() => setShowProjectModal(false)}
        onSave={handleProjectSave}
        mode={projectModalMode}
      />
      <ProjectBrowserModal
        isOpen={showProjectBrowserModal}
        onClose={() => setShowProjectBrowserModal(false)}
        onLoadWorkflow={async (workflow: WorkflowFile, workflowPath?: string) => {
          await loadWorkflow(workflow, workflowPath);
          setShowProjectBrowserModal(false);
          const loadedId = useWorkflowStore.getState().workflowId;
          if (loadedId) {
            router.replace(`/studio/${encodeURIComponent(loadedId)}`);
          }
        }}
      />
      <header className="h-11 bg-neutral-900 border-b border-neutral-800 flex items-center justify-between px-4 shrink-0">
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1">
            <button
              onClick={() => setShowQuickstart(true)}
              className="flex items-center gap-2 hover:opacity-80 transition-opacity"
              title="Open welcome screen"
            >
              <img src="/logo-node.svg" alt="Tasmeemai" className="w-12 h-12" />
              <h1 className="text-2xl font-semibold text-neutral-100 tracking-tight hidden md:block">
                Tasmeemai
              </h1>
            </button>
            <AppSwitcher align="start">
              <div
                role="button"
                className="p-1 text-neutral-400 hover:text-neutral-200 hover:bg-neutral-800 rounded transition-colors cursor-pointer"
                title="Switch app"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 15L12 18.75 15.75 15m-7.5-6L12 5.25 15.75 9" />
                </svg>
              </div>
            </AppSwitcher>
          </div>

          {/* Mode switcher pill */}
          <div className="flex items-center ms-2 md:ms-4 ps-2 md:ps-4 md:border-s border-neutral-700">
            <div className="flex items-center bg-neutral-800 rounded-md p-0.5">
              <button
                onClick={() => router.push("/studio/simple")}
                className={`px-2.5 py-1 text-xs font-medium rounded transition-colors ${
                  isSimpleMode
                    ? "bg-neutral-700 text-neutral-100"
                    : "text-neutral-400 hover:text-neutral-200"
                }`}
              >
                Simple
              </button>
              <button
                onClick={() => router.push("/studio")}
                className={`px-2.5 py-1 text-xs font-medium rounded transition-colors ${
                  !isSimpleMode
                    ? "bg-neutral-700 text-neutral-100"
                    : "text-neutral-400 hover:text-neutral-200"
                }`}
              >
                Workflow
              </button>
            </div>
          </div>

          {!isSimpleMode && <div className="flex items-center gap-2 ms-4 ps-4 border-s border-neutral-700">
            {isProjectConfigured ? (
              <>
                <span className="text-sm text-neutral-300">{workflowName}</span>
                <span className="text-neutral-600">|</span>
                <CostIndicator />

                {/* File operations group */}
                <div className="flex items-center gap-0.5 ms-2 ps-2 border-s border-neutral-700/50">
                  <button
                    onClick={() => canSave ? saveToFile() : handleOpenSettings()}
                    disabled={isSaving}
                    className="relative p-1.5 text-neutral-400 hover:text-neutral-200 hover:bg-neutral-800 rounded transition-colors disabled:opacity-50"
                    title={isSaving ? "Saving..." : canSave ? "Save project" : "Configure save location"}
                  >
                    <svg
                      className="w-4 h-4"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      strokeWidth={1.5}
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m.75 12 3 3m0 0 3-3m-3 3v-6m-1.5-9H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z"
                      />
                    </svg>
                    {hasUnsavedChanges && !isSaving && (
                      <span className="absolute top-0.5 end-0.5 w-2 h-2 rounded-full bg-red-500 ring-2 ring-neutral-900" />
                    )}
                  </button>
                  {saveDirectoryPath && !isCloudMode() && (
                    <button
                      onClick={handleOpenDirectory}
                      className="p-1.5 text-neutral-400 hover:text-neutral-200 hover:bg-neutral-800 rounded transition-colors"
                      title="Open Project Folder"
                    >
                      <svg
                        className="w-4 h-4"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                        strokeWidth={2}
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          d="M13.5 6H5.25A2.25 2.25 0 0 0 3 8.25v10.5A2.25 2.25 0 0 0 5.25 21h10.5A2.25 2.25 0 0 0 18 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25"
                        />
                      </svg>
                    </button>
                  )}
                  <button
                    onClick={handleOpenFile}
                    className="p-1.5 text-neutral-400 hover:text-neutral-200 hover:bg-neutral-800 rounded transition-colors"
                    title="Open project"
                  >
                    <svg
                      className="w-4 h-4"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      strokeWidth={2}
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M2.25 12.75V12A2.25 2.25 0 014.5 9.75h15A2.25 2.25 0 0121.75 12v.75m-8.69-6.44l-2.12-2.12a1.5 1.5 0 00-1.061-.44H4.5A2.25 2.25 0 002.25 6v12a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9a2.25 2.25 0 00-2.25-2.25h-5.379a1.5 1.5 0 01-1.06-.44z"
                      />
                    </svg>
                  </button>
                </div>

                {settingsButtons}

                {/* Close project button */}
                <div className="flex items-center gap-0.5 ms-1 ps-1 border-s border-neutral-700/50">
                  <button
                    onClick={handleCloseProject}
                    className="p-1.5 text-neutral-400 hover:text-neutral-200 hover:bg-neutral-800 rounded transition-colors"
                    title="Close project"
                  >
                    <svg
                      className="w-4 h-4"
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
              </>
            ) : (
              <>
                <span className="text-sm text-neutral-500 italic">Untitled</span>

                {/* File operations group */}
                <div className="flex items-center gap-0.5 ms-2 ps-2 border-s border-neutral-700/50">
                  <button
                    onClick={handleNewProject}
                    className="relative p-1.5 text-neutral-400 hover:text-neutral-200 hover:bg-neutral-800 rounded transition-colors"
                    title="Save project"
                  >
                    <svg
                      className="w-4 h-4"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      strokeWidth={1.5}
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m.75 12 3 3m0 0 3-3m-3 3v-6m-1.5-9H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z"
                      />
                    </svg>
                    <span className="absolute top-0.5 end-0.5 w-2 h-2 rounded-full bg-red-500 ring-2 ring-neutral-900" />
                  </button>
                  <button
                    onClick={handleOpenFile}
                    className="p-1.5 text-neutral-400 hover:text-neutral-200 hover:bg-neutral-800 rounded transition-colors"
                    title="Open project"
                  >
                    <svg
                      className="w-4 h-4"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      strokeWidth={2}
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M2.25 12.75V12A2.25 2.25 0 014.5 9.75h15A2.25 2.25 0 0121.75 12v.75m-8.69-6.44l-2.12-2.12a1.5 1.5 0 00-1.061-.44H4.5A2.25 2.25 0 002.25 6v12a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9a2.25 2.25 0 00-2.25-2.25h-5.379a1.5 1.5 0 01-1.06-.44z"
                      />
                    </svg>
                  </button>
                </div>

                {settingsButtons}
              </>
            )}
          </div>}
        </div>

        {/* Desktop right-side items */}
        <div className="hidden md:flex items-center gap-3 text-xs">
          {!isSimpleMode && previousWorkflowSnapshot && (
            <button
              onClick={handleRevertAIChanges}
              className="px-2.5 py-1.5 text-xs text-neutral-300 hover:text-neutral-100 bg-neutral-700/50 hover:bg-neutral-700 border border-neutral-600 rounded transition-colors"
              title="Restore workflow from before AI changes"
            >
              Revert AI Changes
            </button>
          )}
          <LanguageSwitcher className="text-neutral-400 hover:text-neutral-200 hover:bg-neutral-800" />
          {!isSimpleMode && <CommentsNavigationIcon />}
          {session?.user ? (
            <>
              <span className="text-neutral-300 truncate max-w-[220px]" title={sessionLabel}>
                {sessionLabel}
              </span>
              <button
                onClick={() => void handleSignOut()}
                disabled={isSigningOut}
                className="text-neutral-400 hover:text-neutral-200 transition-colors disabled:opacity-60"
                title="Sign out"
              >
                {isSigningOut ? "Signing out..." : "Sign out"}
              </button>
            </>
          ) : (
            <>
              <Link
                href="/sign-in"
                className="text-neutral-400 hover:text-neutral-200 transition-colors"
              >
                Sign in
              </Link>
              <Link
                href="/sign-up"
                className="text-neutral-400 hover:text-neutral-200 transition-colors"
              >
                Sign up
              </Link>
            </>
          )}
          {!isSimpleMode && (
            <>
              <span className="text-neutral-500">&middot;</span>
              <span className="text-neutral-400">
                {isProjectConfigured ? (
                  isSaving ? (
                    "Saving..."
                  ) : lastSavedAt ? (
                    `Saved ${formatTime(lastSavedAt)}`
                  ) : (
                    "Not saved"
                  )
                ) : (
                  "Not saved"
                )}
              </span>
              <span className="text-neutral-500">&middot;</span>
              <a
                href="https://x.com/abodiatrash"
                target="_blank"
                rel="noopener noreferrer"
                className="text-neutral-400 hover:text-neutral-200 transition-colors"
              >
                Made by abodi
              </a>
              <span className="text-neutral-500">&middot;</span>
              <button
                onClick={() => setShortcutsDialogOpen(true)}
                className="text-neutral-400 hover:text-neutral-200 transition-colors"
                title="Keyboard shortcuts (?)"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 6.75A2.25 2.25 0 014.5 4.5h15a2.25 2.25 0 012.25 2.25v10.5A2.25 2.25 0 0119.5 19.5h-15a2.25 2.25 0 01-2.25-2.25V6.75z" />
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 8h.01M10 8h.01M14 8h.01M18 8h.01M6 12h.01M10 12h.01M14 12h.01M18 12h.01M8 16h8" />
                </svg>
              </button>
            </>
          )}
          {!isSimpleMode && <span className="text-neutral-500">&middot;</span>}
        </div>

        {/* Mobile menu button + dropdown */}
        <div className="flex md:hidden relative" ref={mobileMenuRef}>
          <button
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            className="p-1.5 text-neutral-400 hover:text-neutral-200 hover:bg-neutral-800 rounded transition-colors"
            title="Menu"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.75a.75.75 0 110-1.5.75.75 0 010 1.5zM12 12.75a.75.75 0 110-1.5.75.75 0 010 1.5zM12 18.75a.75.75 0 110-1.5.75.75 0 010 1.5z" />
            </svg>
          </button>

          {mobileMenuOpen && (
            <div className="absolute top-full end-0 mt-1 w-48 bg-neutral-800 border border-neutral-700 rounded-md shadow-xl z-50 py-1">
              <div className="px-3 py-2 border-b border-neutral-700">
                <LanguageSwitcher className="text-neutral-400 hover:text-neutral-200 w-full text-start" />
              </div>
              {session?.user ? (
                <>
                  <div className="px-3 py-2 text-xs text-neutral-300 truncate">
                    {sessionLabel}
                  </div>
                  <button
                    onClick={() => {
                      setMobileMenuOpen(false);
                      void handleSignOut();
                    }}
                    disabled={isSigningOut}
                    className="w-full text-start px-3 py-2 text-xs text-neutral-400 hover:text-neutral-200 hover:bg-neutral-700/50 transition-colors disabled:opacity-60"
                  >
                    {isSigningOut ? "Signing out..." : "Sign out"}
                  </button>
                </>
              ) : (
                <>
                  <Link
                    href="/sign-in"
                    onClick={() => setMobileMenuOpen(false)}
                    className="block px-3 py-2 text-xs text-neutral-400 hover:text-neutral-200 hover:bg-neutral-700/50 transition-colors"
                  >
                    Sign in
                  </Link>
                  <Link
                    href="/sign-up"
                    onClick={() => setMobileMenuOpen(false)}
                    className="block px-3 py-2 text-xs text-neutral-400 hover:text-neutral-200 hover:bg-neutral-700/50 transition-colors"
                  >
                    Sign up
                  </Link>
                </>
              )}
            </div>
          )}
        </div>
      </header>
      <KeyboardShortcutsDialog
        isOpen={shortcutsDialogOpen}
        onClose={() => setShortcutsDialogOpen(false)}
      />
    </>
  );
}
