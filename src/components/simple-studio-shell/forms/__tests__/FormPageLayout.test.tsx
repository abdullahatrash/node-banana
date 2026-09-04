import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { FormPageLayout } from "../FormPageLayout";

describe("FormPageLayout", () => {
  it("renders the form body slot", () => {
    render(
      <FormPageLayout infoPanel={<div>Info</div>}>
        <div>Form body</div>
      </FormPageLayout>,
    );
    expect(screen.getByText("Form body")).toBeInTheDocument();
  });

  it("renders the info panel slot", () => {
    render(
      <FormPageLayout infoPanel={<div>Info content</div>}>
        <div>Form body</div>
      </FormPageLayout>,
    );
    expect(screen.getByText("Info content")).toBeInTheDocument();
  });

  it("renders both slots in the same document", () => {
    render(
      <FormPageLayout infoPanel={<div data-testid="panel">Panel</div>}>
        <div data-testid="body">Body</div>
      </FormPageLayout>,
    );
    expect(screen.getByTestId("body")).toBeInTheDocument();
    expect(screen.getByTestId("panel")).toBeInTheDocument();
    const main = screen.getByRole("main");
    expect(main).toHaveClass("flex-col", "lg:flex-row");
    expect(main).not.toHaveClass("flex-col-reverse");
    expect(
      screen.getByTestId("body").compareDocumentPosition(screen.getByTestId("panel"))
      & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });
});
