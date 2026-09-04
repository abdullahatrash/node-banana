import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { I18nTestProvider } from "@/test/i18n";
import EditorUpgradePage from "./page";
import EditorCatchAll from "./[...slug]/page";

describe("editor direction", () => {
  it.each([
    ["upgrade", EditorUpgradePage],
    ["unavailable", EditorCatchAll],
  ] as const)("renders the %s screen as RTL in Arabic", (_name, Page) => {
    const { container } = render(
      <I18nTestProvider locale="ar">
        <Page />
      </I18nTestProvider>,
    );

    expect(container.firstElementChild).toHaveAttribute("lang", "ar");
    expect(container.firstElementChild).toHaveAttribute("dir", "rtl");
    expect(screen.getByRole("link")).toHaveAttribute("href", "/simple-studio/videos");
  });

  it("preserves LTR direction in English", () => {
    const { container } = render(
      <I18nTestProvider locale="en">
        <EditorUpgradePage />
      </I18nTestProvider>,
    );

    expect(container.firstElementChild).toHaveAttribute("dir", "ltr");
  });
});
