import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, beforeEach, vi } from "vitest";
import { GenerateProgress } from "../GenerateProgress";
import {
  useSimpleStudioStore,
  type Generation,
  type SimpleStudioMode,
} from "@/store/simpleStudioStore";

function makeGeneration(
  id: string,
  status: Generation["status"],
  batchId = "b1",
  mode: SimpleStudioMode = "photo"
): Generation {
  return {
    id,
    batchId,
    status,
    result: null,
    assetId: null,
    error: null,
    mode,
    aspectRatio: "1:1",
    prompt: "",
    createdAt: 0,
    modelName: null,
  };
}

describe("GenerateProgress", () => {
  let cancelSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    cancelSpy = vi.fn();
    useSimpleStudioStore.setState({
      mode: "photo",
      currentBatchId: "b1",
      generationsByMode: {
        photo: [
          makeGeneration("1", "complete"),
          makeGeneration("2", "complete"),
          makeGeneration("3", "generating"),
          makeGeneration("4", "pending"),
        ],
        video: [],
        copy: [],
      },
      generations: [
        makeGeneration("1", "complete"),
        makeGeneration("2", "complete"),
        makeGeneration("3", "generating"),
        makeGeneration("4", "pending"),
      ],
      cancelGeneration: cancelSpy,
    });
  });

  it("renders progressbar with computed percentage from the batch", () => {
    render(<GenerateProgress />);
    const bar = screen.getByRole("progressbar");
    // 2 complete out of 4 → 50
    expect(bar).toHaveAttribute("aria-valuenow", "50");
  });

  it("shows done/total counts", () => {
    render(<GenerateProgress />);
    expect(screen.getByText("2/4")).toBeInTheDocument();
  });

  it("counts failed generations toward done", () => {
    useSimpleStudioStore.setState({
      generations: [
        makeGeneration("1", "complete"),
        makeGeneration("2", "failed"),
      ],
    });
    render(<GenerateProgress />);
    expect(screen.getByText("2/2")).toBeInTheDocument();
    expect(screen.getByRole("progressbar")).toHaveAttribute(
      "aria-valuenow",
      "100"
    );
  });

  it("clicking Cancel calls cancelGeneration", async () => {
    render(<GenerateProgress />);
    await userEvent.click(screen.getByRole("button", { name: /cancel/i }));
    expect(cancelSpy).toHaveBeenCalledTimes(1);
  });

  it("renders 0% with no current batch", () => {
    useSimpleStudioStore.setState({ currentBatchId: null });
    render(<GenerateProgress />);
    expect(screen.getByRole("progressbar")).toHaveAttribute(
      "aria-valuenow",
      "0"
    );
    expect(screen.getByText("0/0")).toBeInTheDocument();
  });
});
