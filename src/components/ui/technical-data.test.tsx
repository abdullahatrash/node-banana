import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { TechnicalBlock, TechnicalCode } from "./technical-data";

describe("technical data primitives", () => {
  it("isolates inline identifiers from an RTL parent", () => {
    render(
      <div dir="rtl">
        <TechnicalCode>sha256:abc_123</TechnicalCode>
      </div>,
    );

    const value = screen.getByText("sha256:abc_123");
    expect(value).toHaveAttribute("dir", "ltr");
    expect(value).toHaveAttribute("data-slot", "technical-code");
    expect(value).toHaveClass("[unicode-bidi:isolate]");
    expect(value).toHaveStyle({ textAlign: "left" });
  });

  it("keeps structured evidence LTR and scrollable", () => {
    render(<TechnicalBlock>{'{"runId":"run_1"}'}</TechnicalBlock>);

    const value = screen.getByText('{"runId":"run_1"}');
    expect(value).toHaveAttribute("dir", "ltr");
    expect(value).toHaveAttribute("data-slot", "technical-block");
    expect(value).toHaveClass("overflow-auto");
    expect(value).toHaveStyle({ textAlign: "left" });
  });
});
