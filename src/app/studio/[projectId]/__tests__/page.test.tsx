import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import { Suspense } from "react";
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

  it("shows loading state initially", async () => {
    // Make getStudioProject return a never-resolving promise so the component
    // stays in loading state after params unwrap and loadProject begins
    const { getStudioProject } = await import("@/lib/studio/client");
    vi.mocked(getStudioProject).mockReturnValue(new Promise(() => {}));

    let resolveParams!: (value: { projectId: string }) => void;
    const paramsPromise = new Promise<{ projectId: string }>((resolve) => {
      resolveParams = resolve;
    });

    // Render while params are still pending — component suspends
    await act(async () => {
      render(
        <Suspense fallback={<div>Suspending...</div>}>
          <StudioProjectPage params={paramsPromise} />
        </Suspense>
      );
    });

    // Component is suspended waiting for params — shows Suspense fallback
    expect(screen.getByText("Suspending...")).toBeInTheDocument();

    // Resolve params — component unsuspends, enters loading state
    // getStudioProject never resolves, so isLoading stays true
    await act(async () => {
      resolveParams({ projectId: "wf_123_abc" });
    });

    expect(screen.getByText("Loading project...")).toBeInTheDocument();
  });

  it("skips fetch when workflowId already matches projectId", async () => {
    mockWorkflowId = "wf_123_abc";

    await act(async () => {
      render(
        <Suspense fallback={<div>Suspending...</div>}>
          <StudioProjectPage params={Promise.resolve({ projectId: "wf_123_abc" })} />
        </Suspense>
      );
    });

    expect(screen.queryByText("Loading project...")).not.toBeInTheDocument();
    expect(screen.getByTestId("header")).toBeInTheDocument();
    expect(screen.getByTestId("canvas")).toBeInTheDocument();
  });

  it("shows error state with link back to studio", async () => {
    const { getStudioProject } = await import("@/lib/studio/client");
    vi.mocked(getStudioProject).mockRejectedValue(new Error("Project not found"));

    await act(async () => {
      render(
        <Suspense fallback={<div>Suspending...</div>}>
          <StudioProjectPage params={Promise.resolve({ projectId: "wf_nonexistent" })} />
        </Suspense>
      );
    });

    expect(await screen.findByText("Project not found")).toBeInTheDocument();
    const link = screen.getByText("Go to Studio");
    expect(link).toBeInTheDocument();
    expect(link.getAttribute("href")).toBe("/studio");
  });
});
