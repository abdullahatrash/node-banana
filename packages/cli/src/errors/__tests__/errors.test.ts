import { describe, expect, it } from "vitest";

import {
  ApiError,
  CliError,
  EXIT_API_ERROR,
  EXIT_OK,
  EXIT_USAGE,
  UsageError,
  renderError,
} from "../errors";

describe("exit codes", () => {
  it("uses the documented codes", () => {
    expect(EXIT_OK).toBe(0);
    expect(EXIT_API_ERROR).toBe(1);
    expect(EXIT_USAGE).toBe(2);
  });
});

describe("error classes", () => {
  it("maps a usage error to exit code 2", () => {
    expect(new UsageError("bad flag").exitCode).toBe(EXIT_USAGE);
  });

  it("maps an API error to exit code 1", () => {
    expect(new ApiError({ message: "boom" }).exitCode).toBe(EXIT_API_ERROR);
  });

  it("carries the structured code and fix from the API", () => {
    const error = new ApiError({
      code: "forbidden",
      message: "This token cannot access this resource.",
      fix: "Use a token whose role grants social:view.",
    });

    expect(error.code).toBe("forbidden");
    expect(error.fix).toBe("Use a token whose role grants social:view.");
    expect(error).toBeInstanceOf(CliError);
  });
});

describe("renderError", () => {
  it("renders a plain error as a single line", () => {
    expect(renderError(new UsageError("unknown command 'frob'"))).toBe(
      "Error: unknown command 'frob'",
    );
  });

  it("renders a structured API error with its code and fix", () => {
    const error = new ApiError({
      code: "forbidden",
      message: "This token cannot access this resource.",
      fix: "Use a token whose role grants social:view.",
    });

    expect(renderError(error)).toBe(
      [
        "Error: This token cannot access this resource.",
        "  code: forbidden",
        "  fix:  Use a token whose role grants social:view.",
      ].join("\n"),
    );
  });

  it("omits code/fix lines when the API error only carries a message", () => {
    // The /workspaces route returns `error: <string>` with no structured shape.
    expect(renderError(new ApiError({ message: "Invalid or revoked API token." }))).toBe(
      "Error: Invalid or revoked API token.",
    );
  });

  it("renders an unknown thrown value defensively", () => {
    expect(renderError("kaboom")).toBe("Error: kaboom");
    expect(renderError(new Error("native failure"))).toBe(
      "Error: native failure",
    );
  });
});
