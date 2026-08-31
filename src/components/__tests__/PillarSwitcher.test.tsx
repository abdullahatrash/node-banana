import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PillarSwitcher } from "../social/PillarSwitcher";

describe("PillarSwitcher", () => {
  it("lists the shipped content pillars without advanced workflow", () => {
    render(<PillarSwitcher currentPillar="social" />);

    expect(screen.getByText("Social Hub")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button"));

    expect(screen.getByText("Content Studio")).toBeInTheDocument();
    expect(screen.getByText("Video Editor")).toBeInTheDocument();
    expect(screen.getByText("Analytics")).toBeInTheDocument();
    expect(screen.queryByText("Advanced Workflow")).not.toBeInTheDocument();
  });
});
