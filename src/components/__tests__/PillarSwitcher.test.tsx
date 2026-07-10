import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PillarSwitcher } from "../social/PillarSwitcher";

describe("PillarSwitcher", () => {
  it("lists only studio and social pillars", () => {
    render(<PillarSwitcher currentPillar="social" />);

    expect(screen.getByText("Social Hub")).toBeInTheDocument();

    const button = screen.getByRole("button");
    button.click();

    expect(screen.getByText("AI Studio")).toBeInTheDocument();
    expect(screen.queryByText("Analytics")).not.toBeInTheDocument();
    expect(screen.queryByText("Video Editor")).not.toBeInTheDocument();
  });
});
