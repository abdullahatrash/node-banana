import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { QuickstartTemplatesView } from "@/components/quickstart/QuickstartTemplatesView";
import { WorkflowFile } from "@/store/workflowStore";

const mockFetch = vi.fn();
global.fetch = mockFetch;

vi.mock("@/lib/quickstart/templates", () => ({
  getAllPresets: () => [
    {
      id: "product-shot",
      name: "Product Shot",
      description: "Place product in a new scene or environment",
      icon: "M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4",
    },
    {
      id: "model-product",
      name: "Model + Product",
      description: "Combine model, product, and scene",
      icon: "M17 20h5v-2a3 3 0 00-5.356-1.857",
    },
    {
      id: "background-swap",
      name: "Background Swap",
      description: "Place subject in a new background",
      icon: "M4 16l4.586-4.586",
    },
  ],
}));

describe("QuickstartTemplatesView", () => {
  const mockOnBack = vi.fn();
  const mockOnWorkflowSelected = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ success: true }),
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("Basic Rendering", () => {
    it("should render header with title", () => {
      render(
        <QuickstartTemplatesView
          onBack={mockOnBack}
          onWorkflowSelected={mockOnWorkflowSelected}
        />
      );

      expect(screen.getByText("Workflow Templates")).toBeInTheDocument();
    });

    it("should render back button", () => {
      render(
        <QuickstartTemplatesView
          onBack={mockOnBack}
          onWorkflowSelected={mockOnWorkflowSelected}
        />
      );

      expect(screen.getByText("Back")).toBeInTheDocument();
    });

    it("should render Quick Start section header", () => {
      render(
        <QuickstartTemplatesView
          onBack={mockOnBack}
          onWorkflowSelected={mockOnWorkflowSelected}
        />
      );

      expect(screen.getByText("Quick Start")).toBeInTheDocument();
    });

    it("should not render community workflows section", () => {
      render(
        <QuickstartTemplatesView
          onBack={mockOnBack}
          onWorkflowSelected={mockOnWorkflowSelected}
        />
      );

      expect(screen.queryByText("Community Workflows")).not.toBeInTheDocument();
    });
  });

  describe("Preset Templates", () => {
    it("should render all preset templates", () => {
      render(
        <QuickstartTemplatesView
          onBack={mockOnBack}
          onWorkflowSelected={mockOnWorkflowSelected}
        />
      );

      expect(screen.getByText("Product Shot")).toBeInTheDocument();
      expect(screen.getByText("Model + Product")).toBeInTheDocument();
      expect(screen.getByText("Background Swap")).toBeInTheDocument();
    });

    it("should call API when preset template is clicked", async () => {
      const mockWorkflow: WorkflowFile = {
        id: "test-id",
        version: 1,
        name: "Product Shot",
        edgeStyle: "curved",
        nodes: [],
        edges: [],
      };

      mockFetch.mockImplementation((url: string) => {
        if (url === "/api/quickstart") {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ success: true, workflow: mockWorkflow }),
          });
        }
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ success: true }),
        });
      });

      render(
        <QuickstartTemplatesView
          onBack={mockOnBack}
          onWorkflowSelected={mockOnWorkflowSelected}
        />
      );

      await act(async () => {
        fireEvent.click(screen.getByText("Product Shot"));
      });

      await waitFor(() => {
        expect(mockFetch).toHaveBeenCalledWith("/api/quickstart", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            templateId: "product-shot",
            contentLevel: "full",
          }),
        });
      });
    });

    it("should call onWorkflowSelected when preset is loaded successfully", async () => {
      const mockWorkflow: WorkflowFile = {
        id: "test-id",
        version: 1,
        name: "Product Shot",
        edgeStyle: "curved",
        nodes: [],
        edges: [],
      };

      mockFetch.mockImplementation((url: string) => {
        if (url === "/api/quickstart") {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ success: true, workflow: mockWorkflow }),
          });
        }
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ success: true }),
        });
      });

      render(
        <QuickstartTemplatesView
          onBack={mockOnBack}
          onWorkflowSelected={mockOnWorkflowSelected}
        />
      );

      await act(async () => {
        fireEvent.click(screen.getByText("Product Shot"));
      });

      await waitFor(() => {
        expect(mockOnWorkflowSelected).toHaveBeenCalledWith(mockWorkflow);
      });
    });
  });

  describe("Error Handling", () => {
    it("should show error message when preset template loading fails", async () => {
      mockFetch.mockImplementation((url: string) => {
        if (url === "/api/quickstart") {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ success: false, error: "Template not found" }),
          });
        }
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ success: true }),
        });
      });

      render(
        <QuickstartTemplatesView
          onBack={mockOnBack}
          onWorkflowSelected={mockOnWorkflowSelected}
        />
      );

      await act(async () => {
        fireEvent.click(screen.getByText("Product Shot"));
      });

      await waitFor(() => {
        expect(screen.getByText("Template not found")).toBeInTheDocument();
      });
    });
  });

  describe("Back Button", () => {
    it("should call onBack when back button is clicked", () => {
      render(
        <QuickstartTemplatesView
          onBack={mockOnBack}
          onWorkflowSelected={mockOnWorkflowSelected}
        />
      );

      fireEvent.click(screen.getByText("Back"));

      expect(mockOnBack).toHaveBeenCalled();
    });
  });
});
