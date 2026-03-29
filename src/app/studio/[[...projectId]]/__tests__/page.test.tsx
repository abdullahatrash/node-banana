import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import { StudioClient } from "../StudioClient";

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

const mockShowToast = vi.fn();
vi.mock("@/components/Toast", () => ({
  useToast: () => ({ show: mockShowToast }),
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
  isWorkflowFile: vi.fn(() => true),
}));

describe("StudioClient", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockWorkflowId = null;
  });

  it("renders canvas immediately for /studio (no projectId)", async () => {
    await act(async () => {
      render(
        <StudioClient
          projectId={null}
          initialProject={null}
          loadError={null}
        />
      );
    });

    expect(screen.getByTestId("header")).toBeInTheDocument();
    expect(screen.getByTestId("canvas")).toBeInTheDocument();
  });

  it("renders canvas without loading screen when project data is provided", async () => {
    await act(async () => {
      render(
        <StudioClient
          projectId="wf_123_abc"
          initialProject={{
            id: "wf_123_abc",
            name: "Test Project",
            workflowJson: { version: 1, name: "Test", nodes: [], edges: [] },
            sourceDirectoryPath: null,
          }}
          loadError={null}
        />
      );
    });

    expect(screen.getByTestId("header")).toBeInTheDocument();
    expect(screen.getByTestId("canvas")).toBeInTheDocument();
    expect(screen.queryByText("Loading project...")).not.toBeInTheDocument();
  });

  it("does not re-hydrate when workflowId already matches", async () => {
    mockWorkflowId = "wf_123_abc";

    await act(async () => {
      render(
        <StudioClient
          projectId="wf_123_abc"
          initialProject={{
            id: "wf_123_abc",
            name: "Test Project",
            workflowJson: { version: 1, name: "Test", nodes: [], edges: [] },
            sourceDirectoryPath: null,
          }}
          loadError={null}
        />
      );
    });

    expect(mockLoadWorkflow).not.toHaveBeenCalled();
  });

  it("shows toast when loadError is provided", async () => {
    await act(async () => {
      render(
        <StudioClient
          projectId="wf_nonexistent"
          initialProject={null}
          loadError="Project not found."
        />
      );
    });

    expect(mockShowToast).toHaveBeenCalledWith("Project not found.", "error");
  });
});
