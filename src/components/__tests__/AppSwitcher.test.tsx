import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AppSwitcher } from "../AppSwitcher";

vi.mock("next/navigation", () => ({
  usePathname: () => "/simple-studio/images",
}));

describe("AppSwitcher", () => {
  it("lists the shipped content surfaces without advanced workflow", () => {
    render(
      <AppSwitcher>
        <span>Open switcher</span>
      </AppSwitcher>,
    );

    fireEvent.click(screen.getByText("Open switcher"));

    expect(screen.getByText("Simple Studio")).toBeInTheDocument();
    expect(screen.getByText("Video Editor")).toBeInTheDocument();
    expect(screen.getByText("Social Hub")).toBeInTheDocument();
    expect(screen.getByText("Analytics")).toBeInTheDocument();
    expect(screen.queryByText("Advanced Workflow")).not.toBeInTheDocument();
    expect(screen.queryByText("Command Center")).not.toBeInTheDocument();
  });
});
