import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AppSwitcher } from "../AppSwitcher";

vi.mock("next/navigation", () => ({
  usePathname: () => "/studio",
}));

describe("AppSwitcher", () => {
  it("lists only shipped studio and social surfaces", () => {
    render(
      <AppSwitcher>
        <button type="button">Open switcher</button>
      </AppSwitcher>,
    );

    fireEvent.click(screen.getByText("Open switcher"));

    expect(screen.getByText("Simple Studio")).toBeInTheDocument();
    expect(screen.getByText("Advanced Workflow")).toBeInTheDocument();
    expect(screen.getByText("Social Hub")).toBeInTheDocument();
    expect(screen.queryByText("Analytics")).not.toBeInTheDocument();
    expect(screen.queryByText("Video Editor")).not.toBeInTheDocument();
    expect(screen.queryByText("Command Center")).not.toBeInTheDocument();
  });
});
