import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import StudioPage from "../page";

vi.mock("next/navigation", () => ({
  useParams: vi.fn(() => ({ projectId: undefined })),
  useRouter: () => ({
    replace: vi.fn(),
    push: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    refresh: vi.fn(),
    prefetch: vi.fn(),
  }),
}));

vi.mock("@xyflow/react", () => ({
  ReactFlowProvider: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
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

vi.mock("@/components/Toast", () => ({
  useToast: () => ({ show: vi.fn() }),
}));

const mockLoadWorkflow = vi.fn();
const mockInitAutoSave = vi.fn();
const mockCleanupAutoSave = vi.fn();
let mockWorkflowId: string | null = null;

vi.mock("@/store/workflowStore", () => {
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
        getState: () => ({ hasUnsavedChanges: false }),
      }
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

describe("StudioPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockWorkflowId = null;
  });

  it("renders canvas immediately without loading screen for /studio", async () => {
    await act(async () => {
      render(<StudioPage />);
    });

    expect(screen.getByTestId("header")).toBeInTheDocument();
    expect(screen.getByTestId("canvas")).toBeInTheDocument();
    expect(screen.queryByText("Loading project...")).not.toBeInTheDocument();
  });

  it("renders canvas immediately when workflowId matches projectId", async () => {
    const { useParams } = await import("next/navigation");
    vi.mocked(useParams).mockReturnValue({ projectId: ["wf_123_abc"] });
    mockWorkflowId = "wf_123_abc";

    await act(async () => {
      render(<StudioPage />);
    });

    expect(screen.getByTestId("header")).toBeInTheDocument();
    expect(screen.getByTestId("canvas")).toBeInTheDocument();
    expect(mockLoadWorkflow).not.toHaveBeenCalled();
  });

  it("attempts to load project from URL when workflowId does not match", async () => {
    const { useParams } = await import("next/navigation");
    vi.mocked(useParams).mockReturnValue({ projectId: ["wf_missing"] });
    const { getStudioProject } = await import("@/lib/studio/client");
    vi.mocked(getStudioProject).mockRejectedValue(new Error("Not found"));

    await act(async () => {
      render(<StudioPage />);
    });

    // Canvas still renders (no blocking loading screen)
    expect(screen.getByTestId("canvas")).toBeInTheDocument();
    // But project load was attempted
    expect(getStudioProject).toHaveBeenCalledWith("wf_missing");
  });
});
