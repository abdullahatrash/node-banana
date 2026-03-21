import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ProjectBrowserModal } from "@/components/ProjectBrowserModal";
import type { WorkflowFile } from "@/store/workflowStore";

const mockListStudioProjects = vi.fn();
const mockGetStudioProject = vi.fn();
const mockDeleteStudioProject = vi.fn();
const mockListStudioAssets = vi.fn();
const mockDeleteStudioAsset = vi.fn();
const mockIsWorkflowFile = vi.fn();

vi.mock("@/lib/studio/client", () => ({
  listStudioProjects: (...args: unknown[]) => mockListStudioProjects(...args),
  getStudioProject: (...args: unknown[]) => mockGetStudioProject(...args),
  deleteStudioProject: (...args: unknown[]) => mockDeleteStudioProject(...args),
  listStudioAssets: (...args: unknown[]) => mockListStudioAssets(...args),
  deleteStudioAsset: (...args: unknown[]) => mockDeleteStudioAsset(...args),
  isWorkflowFile: (...args: unknown[]) => mockIsWorkflowFile(...args),
}));

const sampleWorkflow: WorkflowFile = {
  id: "wf_1",
  version: 1,
  name: "Project One",
  edgeStyle: "angular",
  nodes: [],
  edges: [],
};

describe("ProjectBrowserModal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockListStudioProjects.mockResolvedValue([
      {
        id: "proj_1",
        name: "Project One",
        slug: "project-one",
        description: null,
        status: "active",
        sourceDirectoryPath: "/tmp/project-one",
        updatedAt: "2026-03-21T08:00:00.000Z",
      },
    ]);
    mockGetStudioProject.mockResolvedValue({
      id: "proj_1",
      name: "Project One",
      slug: "project-one",
      description: null,
      status: "active",
      sourceDirectoryPath: "/tmp/project-one",
      updatedAt: "2026-03-21T08:00:00.000Z",
      createdAt: "2026-03-21T07:00:00.000Z",
      workflowJson: sampleWorkflow,
    });
    mockListStudioAssets.mockResolvedValue([
      {
        id: "asset_1",
        type: "image",
        storageProvider: "local",
        storageKey: "/tmp/project-one/generations/a.png",
        mimeType: "image/png",
        sizeBytes: 1024,
        createdAt: "2026-03-21T08:00:00.000Z",
        updatedAt: "2026-03-21T08:00:00.000Z",
      },
    ]);
    mockIsWorkflowFile.mockImplementation((payload: unknown) => {
      const record = payload as Record<string, unknown> | null;
      return Boolean(record?.version === 1 && Array.isArray(record?.nodes) && Array.isArray(record?.edges));
    });
  });

  it("loads projects when opened", async () => {
    render(
      <ProjectBrowserModal isOpen onClose={vi.fn()} onLoadWorkflow={vi.fn()} />,
    );

    await waitFor(() => {
      expect(mockListStudioProjects).toHaveBeenCalledTimes(1);
    });

    expect(screen.getByTestId("open-project-button")).toBeInTheDocument();
  });

  it("opens selected project and passes workflow to callback", async () => {
    const onLoadWorkflow = vi.fn().mockResolvedValue(undefined);

    render(
      <ProjectBrowserModal isOpen onClose={vi.fn()} onLoadWorkflow={onLoadWorkflow} />,
    );

    await waitFor(() => {
      expect(screen.getByTestId("open-project-button")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId("open-project-button"));

    await waitFor(() => {
      expect(onLoadWorkflow).toHaveBeenCalledWith(sampleWorkflow, "/tmp/project-one");
    });
  });

  it("soft-deletes an asset from the list", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    mockDeleteStudioAsset.mockResolvedValue(undefined);

    render(
      <ProjectBrowserModal isOpen onClose={vi.fn()} onLoadWorkflow={vi.fn()} />,
    );

    await waitFor(() => {
      expect(screen.getByTestId("delete-asset-asset_1")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId("delete-asset-asset_1"));

    await waitFor(() => {
      expect(mockDeleteStudioAsset).toHaveBeenCalledWith("asset_1");
    });
  });

  it("restores an optimistically removed asset when delete is forbidden", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    mockDeleteStudioAsset.mockRejectedValue(
      new Error("You do not have access to this workspace."),
    );

    render(
      <ProjectBrowserModal isOpen onClose={vi.fn()} onLoadWorkflow={vi.fn()} />,
    );

    await waitFor(() => {
      expect(screen.getByTestId("delete-asset-asset_1")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId("delete-asset-asset_1"));

    await waitFor(() => {
      expect(mockDeleteStudioAsset).toHaveBeenCalledWith("asset_1");
    });

    expect(screen.getByTestId("delete-asset-asset_1")).toBeInTheDocument();
    expect(
      screen.getByText("You do not have access to this workspace."),
    ).toBeInTheDocument();
  });

  it("restores an optimistically removed project when delete is forbidden", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    mockDeleteStudioProject.mockRejectedValue(
      new Error("You do not have access to this workspace."),
    );

    render(
      <ProjectBrowserModal isOpen onClose={vi.fn()} onLoadWorkflow={vi.fn()} />,
    );

    await waitFor(() => {
      expect(screen.getByTestId("delete-project-button")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId("delete-project-button"));

    await waitFor(() => {
      expect(mockDeleteStudioProject).toHaveBeenCalledWith("proj_1");
    });

    expect(screen.getAllByText("Project One").length).toBeGreaterThan(0);
    expect(screen.getByTestId("delete-project-button")).toBeInTheDocument();
    expect(
      screen.getByText("You do not have access to this workspace."),
    ).toBeInTheDocument();
  });

  it("shows a clear sign-in message for 401-style failures", async () => {
    mockListStudioProjects.mockRejectedValue(
      new Error("Please sign in to access AI Studio."),
    );

    render(
      <ProjectBrowserModal isOpen onClose={vi.fn()} onLoadWorkflow={vi.fn()} />,
    );

    await waitFor(() => {
      expect(
        screen.getByText("Please sign in to access AI Studio."),
      ).toBeInTheDocument();
    });
  });

  it("shows a clear access message for 403-style failures", async () => {
    mockListStudioProjects.mockRejectedValue(
      new Error("You do not have access to this workspace."),
    );

    render(
      <ProjectBrowserModal isOpen onClose={vi.fn()} onLoadWorkflow={vi.fn()} />,
    );

    await waitFor(() => {
      expect(
        screen.getByText("You do not have access to this workspace."),
      ).toBeInTheDocument();
    });
  });

  it("supports JSON fallback loading", async () => {
    const onLoadWorkflow = vi.fn().mockResolvedValue(undefined);

    const { container } = render(
      <ProjectBrowserModal isOpen onClose={vi.fn()} onLoadWorkflow={onLoadWorkflow} />,
    );

    fireEvent.click(screen.getByText("JSON File"));
    fireEvent.click(screen.getByText("Choose JSON File"));

    const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement;
    const file = {
      name: "workflow.json",
      type: "application/json",
      text: vi.fn().mockResolvedValue(JSON.stringify(sampleWorkflow)),
    } as unknown as File;

    fireEvent.change(fileInput, { target: { files: [file] } });

    await waitFor(() => {
      expect(onLoadWorkflow).toHaveBeenCalledWith(sampleWorkflow);
    });
  });
});
