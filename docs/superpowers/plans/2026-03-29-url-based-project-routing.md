# URL-Based Project Routing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make projects URL-addressable at `/studio/<projectId>`, auto-create DB records when loading templates (fixing the auto-save bug), and enforce a soft project limit to prevent orphan accumulation.

**Architecture:** Convert the static `/studio` route into a catch-all that handles both no-project (`/studio`) and project-loaded (`/studio/<projectId>`) states. After any project creation — whether from the "New Project" dialog, a template, or the project browser — navigate to `/studio/<id>`. On page load, if a project ID is in the URL, fetch and load the project. A `countProjects` query plus a hardcoded `MAX_PROJECTS` constant blocks creation when the limit is reached.

**Tech Stack:** Next.js App Router dynamic routes, Zustand, `next/navigation`, existing `getStudioProject()` / `upsertStudioProject()` / `listProjects()` APIs, Drizzle ORM count query.

---

## File Structure

| Action | Path | Responsibility |
|--------|------|----------------|
| Keep | `src/app/studio/layout.tsx` | Auth guard (shared by `/studio` and `/studio/[projectId]`) |
| Keep (minor) | `src/app/studio/page.tsx` | Blank canvas — no project loaded |
| Create | `src/app/studio/[projectId]/page.tsx` | Dynamic route — loads project from URL on mount |
| Modify | `src/components/Header.tsx` | `router.replace(/studio/${id})` after project create/open |
| Modify | `src/components/WorkflowCanvas.tsx` | Create DB record + navigate after template load |
| Modify | `src/lib/studio/repository.ts` | Add `countProjects()` query |
| Modify | `src/app/api/studio/projects/route.ts` | Add project count to GET response + limit check on POST |
| Modify | `src/lib/studio/client.ts` | Add `getProjectCount()` client function |
| Create | `src/lib/studio/constants.ts` | `MAX_PROJECTS` constant |
| Create | `src/app/studio/[projectId]/__tests__/page.test.tsx` | Tests for the dynamic route |
| Create | `src/lib/studio/__tests__/constants.test.ts` | Tests for project limit constant |

---

### Task 1: Add `countProjects` to the Repository Layer

**Files:**
- Modify: `src/lib/studio/repository.ts:499-506`

- [ ] **Step 1: Add the `countProjects` function**

In `src/lib/studio/repository.ts`, add this function after the existing `listProjects` function (after line 506):

```typescript
export async function countProjects(workspaceId: string): Promise<number> {
  const db = getDb();
  const [result] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(projects)
    .where(and(eq(projects.workspaceId, workspaceId), isNull(projects.deletedAt)));
  return result?.count ?? 0;
}
```

- [ ] **Step 2: Verify the file compiles**

Run: `npx tsc --noEmit src/lib/studio/repository.ts 2>&1 | head -20`
Expected: No errors related to `countProjects`.

- [ ] **Step 3: Commit**

```bash
git add src/lib/studio/repository.ts
git commit -m "feat: add countProjects query to repository layer"
```

---

### Task 2: Create the `MAX_PROJECTS` Constant

**Files:**
- Create: `src/lib/studio/constants.ts`
- Create: `src/lib/studio/__tests__/constants.test.ts`

- [ ] **Step 1: Write the test**

```typescript
// src/lib/studio/__tests__/constants.test.ts
import { describe, it, expect } from "vitest";
import { MAX_PROJECTS_PER_WORKSPACE } from "../constants";

describe("studio constants", () => {
  it("MAX_PROJECTS_PER_WORKSPACE is a positive integer", () => {
    expect(MAX_PROJECTS_PER_WORKSPACE).toBeGreaterThan(0);
    expect(Number.isInteger(MAX_PROJECTS_PER_WORKSPACE)).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run src/lib/studio/__tests__/constants.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Create the constants file**

```typescript
// src/lib/studio/constants.ts
/**
 * Maximum number of active (non-deleted) projects per workspace.
 * This is a soft limit enforced at the API layer. When a billing/plans
 * system is added, this value should be read from the workspace's plan.
 */
export const MAX_PROJECTS_PER_WORKSPACE = 3;
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm vitest run src/lib/studio/__tests__/constants.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/studio/constants.ts src/lib/studio/__tests__/constants.test.ts
git commit -m "feat: add MAX_PROJECTS_PER_WORKSPACE constant (soft limit of 3)"
```

---

### Task 3: Add Project Count + Limit Check to the API

The GET endpoint returns the current count so the client can show UI warnings. The POST endpoint rejects creation when the limit is reached.

**Files:**
- Modify: `src/app/api/studio/projects/route.ts`

- [ ] **Step 1: Update the GET response to include project count**

In `src/app/api/studio/projects/route.ts`, update the import and response.

Find this import (line 4):

```typescript
import { listProjects, upsertProject } from "@/lib/studio/repository";
```

Replace with:

```typescript
import { countProjects, listProjects, upsertProject } from "@/lib/studio/repository";
import { MAX_PROJECTS_PER_WORKSPACE } from "@/lib/studio/constants";
```

Find the GET response interface (line 6-10):

```typescript
interface ProjectsGetResponse {
  success: boolean;
  projects?: Awaited<ReturnType<typeof listProjects>>;
  error?: string;
}
```

Replace with:

```typescript
interface ProjectsGetResponse {
  success: boolean;
  projects?: Awaited<ReturnType<typeof listProjects>>;
  projectCount?: number;
  maxProjects?: number;
  error?: string;
}
```

Find the GET handler's success return (around line 49-53):

```typescript
    const projects = await listProjects(authz.workspaceId);
    return NextResponse.json({
      success: true,
      projects,
    });
```

Replace with:

```typescript
    const [projectsList, projectCount] = await Promise.all([
      listProjects(authz.workspaceId),
      countProjects(authz.workspaceId),
    ]);
    return NextResponse.json({
      success: true,
      projects: projectsList,
      projectCount,
      maxProjects: MAX_PROJECTS_PER_WORKSPACE,
    });
```

- [ ] **Step 2: Add limit check to the POST handler**

In the POST handler, add a limit check before `upsertProject`. Find this block (around line 96-104):

```typescript
    const authz = await authorizeStudioRequest(request, {
      route: "/api/studio/projects",
      action: "write",
    });
    if (!authz.authorized) {
      return authzErrorResponse(authz);
    }

    const project = await upsertProject({
```

Replace with:

```typescript
    const authz = await authorizeStudioRequest(request, {
      route: "/api/studio/projects",
      action: "write",
    });
    if (!authz.authorized) {
      return authzErrorResponse(authz);
    }

    // Enforce project limit on new project creation (skip for updates to existing projects)
    if (!body.projectId) {
      const currentCount = await countProjects(authz.workspaceId);
      if (currentCount >= MAX_PROJECTS_PER_WORKSPACE) {
        return NextResponse.json(
          {
            success: false,
            error: `Project limit reached (${MAX_PROJECTS_PER_WORKSPACE}). Delete an existing project to create a new one.`,
          },
          { status: 403 },
        );
      }
    }

    const project = await upsertProject({
```

- [ ] **Step 3: Verify build compiles**

Run: `npx tsc --noEmit 2>&1 | grep "studio/projects" | head -10`
Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add src/app/api/studio/projects/route.ts
git commit -m "feat: add project count to GET response and limit check on POST"
```

---

### Task 4: Add `getProjectCount` Client Helper

**Files:**
- Modify: `src/lib/studio/client.ts`

- [ ] **Step 1: Add the client function**

In `src/lib/studio/client.ts`, add this function after the `listStudioProjects` function (after line 309):

```typescript
export async function getStudioProjectCount(): Promise<{
  count: number;
  max: number;
}> {
  const data = await fetchApi("/api/studio/projects");
  const count = typeof data.projectCount === "number" ? data.projectCount : 0;
  const max = typeof data.maxProjects === "number" ? data.maxProjects : Infinity;
  return { count, max };
}
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/studio/client.ts
git commit -m "feat: add getStudioProjectCount client helper"
```

---

### Task 5: Create the Dynamic `/studio/[projectId]` Route

**Files:**
- Create: `src/app/studio/[projectId]/page.tsx`

- [ ] **Step 1: Create the page component**

```tsx
// src/app/studio/[projectId]/page.tsx
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
```

- [ ] **Step 2: Verify the file compiles**

Run: `npx tsc --noEmit 2>&1 | grep "projectId" | head -10`
Expected: No errors in the new file.

- [ ] **Step 3: Commit**

```bash
git add src/app/studio/\[projectId\]/page.tsx
git commit -m "feat: add dynamic /studio/[projectId] route for URL-based project loading"
```

---

### Task 6: Update Header to Navigate After Project Create/Open

**Files:**
- Modify: `src/components/Header.tsx:132-142` (handleProjectSave)
- Modify: `src/components/Header.tsx:246-252` (ProjectBrowserModal callback)

- [ ] **Step 1: Add `router.replace` after project creation**

In `src/components/Header.tsx`, find `handleProjectSave` (line 132):

```typescript
  const handleProjectSave = async (id: string, name: string, path: string | null) => {
    setWorkflowMetadata(id, name, path); // generationsPath is auto-derived
    setShowProjectModal(false);
    // Small delay to let state update
    setTimeout(() => {
      saveToFile().catch((error) => {
        console.error("Failed to save project:", error);
        alert("Failed to save project. Please try again.");
      });
    }, 50);
  };
```

Replace with:

```typescript
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
```

- [ ] **Step 2: Add `router.replace` after opening a project from the browser**

In `src/components/Header.tsx`, find the `ProjectBrowserModal` callback (around line 248):

```tsx
        onLoadWorkflow={async (workflow: WorkflowFile, workflowPath?: string) => {
          await loadWorkflow(workflow, workflowPath);
          setShowProjectBrowserModal(false);
        }}
```

Replace with:

```tsx
        onLoadWorkflow={async (workflow: WorkflowFile, workflowPath?: string) => {
          await loadWorkflow(workflow, workflowPath);
          setShowProjectBrowserModal(false);
          const loadedId = useWorkflowStore.getState().workflowId;
          if (loadedId) {
            router.replace(`/studio/${encodeURIComponent(loadedId)}`);
          }
        }}
```

- [ ] **Step 3: Commit**

```bash
git add src/components/Header.tsx
git commit -m "feat: navigate to /studio/[projectId] after project create and open"
```

---

### Task 7: Auto-Create DB Record on Template Load (Fix Auto-Save Bug)

This is the key fix. When a template or AI-generated workflow is loaded onto the canvas, immediately create a DB project record so auto-save works. Also enforce the project limit before creation.

**Files:**
- Modify: `src/components/WorkflowCanvas.tsx:1933-1950` (WelcomeModal callbacks)

- [ ] **Step 1: Import required dependencies**

In `src/components/WorkflowCanvas.tsx`, add these imports at the top of the file. Find the existing import block and add:

```typescript
import { useRouter } from "next/navigation";
import { upsertStudioProject, getStudioProjectCount } from "@/lib/studio/client";
import { isCloudMode } from "@/lib/storage";
```

Note: `isCloudMode` may already be imported — check first and skip if so.

- [ ] **Step 2: Add `useRouter` hook inside the component**

Inside the `WorkflowCanvas` function component, near the other hooks (around line 305), add:

```typescript
const router = useRouter();
```

- [ ] **Step 3: Update the `onWorkflowGenerated` callback**

Find the WelcomeModal's `onWorkflowGenerated` callback (line 1935):

```tsx
          onWorkflowGenerated={async (workflow) => {
            await loadWorkflow(workflow);
            setShowQuickstart(false);
          }}
```

Replace with:

```tsx
          onWorkflowGenerated={async (workflow) => {
            // Enforce project limit in cloud mode before creating a new project
            if (isCloudMode()) {
              try {
                const { count, max } = await getStudioProjectCount();
                if (count >= max) {
                  showToast(
                    `Project limit reached (${max}). Delete an existing project to create a new one.`,
                    "error"
                  );
                  return;
                }
              } catch {
                // If count check fails, proceed anyway — the API will enforce the limit on save
              }
            }

            await loadWorkflow(workflow);
            setShowQuickstart(false);

            // In cloud mode, create a DB record immediately so auto-save works
            const loadedId = useWorkflowStore.getState().workflowId;
            const loadedName = useWorkflowStore.getState().workflowName;
            if (isCloudMode() && loadedId && loadedName) {
              try {
                await upsertStudioProject({
                  projectId: loadedId,
                  name: loadedName,
                  workflowJson: null, // Will be populated on first auto-save
                });
              } catch (err) {
                console.error("Failed to create project record for template:", err);
              }
              router.replace(`/studio/${encodeURIComponent(loadedId)}`);
            }
          }}
```

- [ ] **Step 4: Update the `onNewProject` callback in WelcomeModal**

Find the `onNewProject` callback (line 1940):

```tsx
          onNewProject={() => {
            clearWorkflow();
            setShowQuickstart(false);
            setShowNewProjectSetup(true);
          }}
```

This callback opens the ProjectSetupModal. The ProjectSetupModal already calls `onSave` which triggers `setWorkflowMetadata` + `saveToFile`. But we need to add navigation here too.

Find the `showNewProjectSetup` ProjectSetupModal (line 1972):

```tsx
      {showNewProjectSetup && (
        <ProjectSetupModal
          isOpen={showNewProjectSetup}
          mode="new"
          onSave={(id, name, directoryPath) => {
            setWorkflowMetadata(id, name, directoryPath);
            setShowNewProjectSetup(false);
          }}
          onClose={() => {
            setShowNewProjectSetup(false);
            setShowQuickstart(true);
          }}
        />
      )}
```

Replace with:

```tsx
      {showNewProjectSetup && (
        <ProjectSetupModal
          isOpen={showNewProjectSetup}
          mode="new"
          onSave={async (id, name, directoryPath) => {
            setWorkflowMetadata(id, name, directoryPath);
            setShowNewProjectSetup(false);
            router.replace(`/studio/${encodeURIComponent(id)}`);
            // Trigger initial save
            setTimeout(() => {
              useWorkflowStore.getState().saveToFile().catch((error) => {
                console.error("Failed to save new project:", error);
              });
            }, 50);
          }}
          onClose={() => {
            setShowNewProjectSetup(false);
            setShowQuickstart(true);
          }}
        />
      )}
```

- [ ] **Step 5: Update the ProjectBrowserModal in WorkflowCanvas**

Find the project browser's `onLoadWorkflow` callback (line 1963):

```tsx
          onLoadWorkflow={async (workflow, workflowPath) => {
            await loadWorkflow(workflow, workflowPath);
            setShowProjectBrowser(false);
            setRestoreQuickstartOnProjectBrowserClose(false);
          }}
```

Replace with:

```tsx
          onLoadWorkflow={async (workflow, workflowPath) => {
            await loadWorkflow(workflow, workflowPath);
            setShowProjectBrowser(false);
            setRestoreQuickstartOnProjectBrowserClose(false);
            const loadedId = useWorkflowStore.getState().workflowId;
            if (loadedId) {
              router.replace(`/studio/${encodeURIComponent(loadedId)}`);
            }
          }}
```

- [ ] **Step 6: Verify build compiles**

Run: `npx tsc --noEmit 2>&1 | grep -i "error" | head -10`
Expected: No new errors.

- [ ] **Step 7: Commit**

```bash
git add src/components/WorkflowCanvas.tsx
git commit -m "feat: auto-create DB record on template load, navigate to project URL

Fixes auto-save error when loading templates in cloud mode by creating
a DB project record immediately. Also enforces project limit before
template load and navigates to /studio/[projectId] after load."
```

---

### Task 8: Write Tests for the Dynamic Route

**Files:**
- Create: `src/app/studio/[projectId]/__tests__/page.test.tsx`

- [ ] **Step 1: Write the test file**

```tsx
// src/app/studio/[projectId]/__tests__/page.test.tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import StudioProjectPage from "../page";

// Mock dependencies
vi.mock("@xyflow/react", () => ({
  ReactFlowProvider: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock("@/components/Header", () => ({
  Header: () => <div data-testid="header">Header</div>,
}));

vi.mock("@/components/WorkflowCanvas", () => ({
  WorkflowCanvas: () => <div data-testid="canvas">Canvas</div>,
}));

vi.mock("@/components/FloatingActionBar", () => ({
  FloatingActionBar: () => null,
}));

vi.mock("@/components/AnnotationModal", () => ({
  AnnotationModal: () => null,
}));

const mockLoadWorkflow = vi.fn();
const mockInitAutoSave = vi.fn();
const mockCleanupAutoSave = vi.fn();
let mockWorkflowId: string | null = null;

vi.mock("@/store/workflowStore", () => {
  const actual = { hasUnsavedChanges: false };
  return {
    useWorkflowStore: Object.assign(
      (selector: (state: Record<string, unknown>) => unknown) => {
        const state: Record<string, unknown> = {
          initializeAutoSave: mockInitAutoSave,
          cleanupAutoSave: mockCleanupAutoSave,
          loadWorkflow: mockLoadWorkflow,
          workflowId: mockWorkflowId,
          hasUnsavedChanges: false,
        };
        return selector(state);
      },
      {
        getState: () => actual,
      },
    ),
  };
});

vi.mock("@/lib/studio/client", () => ({
  getStudioProject: vi.fn(),
  isWorkflowFile: vi.fn(() => true),
}));

vi.mock("@/store/utils/localStorage", () => ({
  loadSaveConfigs: vi.fn(() => ({})),
}));

vi.mock("@/lib/storage", () => ({
  isCloudMode: vi.fn(() => true),
}));

describe("StudioProjectPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockWorkflowId = null;
  });

  it("shows loading state initially", () => {
    render(
      <StudioProjectPage params={Promise.resolve({ projectId: "wf_123_abc" })} />
    );
    expect(screen.getByText("Loading project...")).toBeInTheDocument();
  });

  it("skips fetch when workflowId already matches projectId", () => {
    mockWorkflowId = "wf_123_abc";

    render(
      <StudioProjectPage params={Promise.resolve({ projectId: "wf_123_abc" })} />
    );

    expect(screen.queryByText("Loading project...")).not.toBeInTheDocument();
    expect(screen.getByTestId("header")).toBeInTheDocument();
    expect(screen.getByTestId("canvas")).toBeInTheDocument();
  });

  it("shows error state with link back to studio", async () => {
    const { getStudioProject } = await import("@/lib/studio/client");
    vi.mocked(getStudioProject).mockRejectedValue(new Error("Project not found"));

    render(
      <StudioProjectPage params={Promise.resolve({ projectId: "wf_nonexistent" })} />
    );

    expect(await screen.findByText("Project not found")).toBeInTheDocument();
    const link = screen.getByText("Go to Studio");
    expect(link).toBeInTheDocument();
    expect(link.getAttribute("href")).toBe("/studio");
  });
});
```

- [ ] **Step 2: Run the tests**

Run: `pnpm vitest run src/app/studio/\\[projectId\\]/__tests__/page.test.tsx`
Expected: All PASS

- [ ] **Step 3: Commit**

```bash
git add src/app/studio/\[projectId\]/__tests__/page.test.tsx
git commit -m "test: add tests for dynamic /studio/[projectId] route"
```

---

### Task 9: End-to-End Verification

- [ ] **Step 1: Run the full test suite**

Run: `pnpm test:run`
Expected: All existing tests still pass, all new tests pass.

- [ ] **Step 2: Manual testing checklist**

Run: `pnpm dev`

1. **New project (from Header):** Go to `/studio` → click save icon → fill name → save → URL should change to `/studio/wf_...` → refresh page → project reloads from URL
2. **Template load:** Go to `/studio` → welcome modal → Templates → pick one → canvas loads, URL changes to `/studio/wf_...` → refresh → project reloads
3. **Auto-save after template:** Load a template → wait 90s → no "workspace access" toast error → check that the toast shows "Saved" or no error
4. **Open from browser:** Click open project icon → pick a project → URL changes → refresh → reloads
5. **Project limit:** Create 3 projects → try to create a 4th (template or new project) → should see error toast "Project limit reached (3)"
6. **Delete + re-create:** Delete a project from browser → create a new one → should succeed
7. **Invalid URL:** Navigate to `/studio/wf_nonexistent` → error screen with "Go to Studio" link
8. **Bare `/studio`:** Still shows blank canvas with welcome modal
9. **Auth guard:** Open `/studio/wf_...` in incognito → redirects to `/sign-in`

- [ ] **Step 3: No commit — verification only**

---

## Design Decisions & Trade-offs

| Decision | Rationale | Alternative |
|----------|-----------|-------------|
| `router.replace` not `router.push` | Prevents cluttering history (create → project shouldn't be two entries) | `router.push` if back-nav to blank canvas is desired |
| Keep `/studio` as blank canvas | Backward-compatible, existing links still work | Redirect to last-opened project (adds complexity) |
| Skip fetch when `workflowId === projectId` | Avoids double-fetch after create/template | Always fetch (wastes bandwidth) |
| Project limit in API **and** client | API is the enforcement point; client check gives fast UX feedback | API-only (slower feedback), client-only (bypassable) |
| `MAX_PROJECTS` as hardcoded constant | No billing system yet; easy to swap for plan-based lookup later | DB column on workspace (premature without plans) |
| Soft-delete projects count as "deleted" | Deleted projects don't count toward limit | Count all projects (punishes users who clean up) |
| Template creates DB record immediately | Fixes auto-save bug; prevents "workspace access" error | Only create on first manual save (bug persists until save) |
