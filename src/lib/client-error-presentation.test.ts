import { describe, expect, it } from "vitest";
import { StudioApiError } from "@/lib/studio/client";
import { presentClientError } from "./client-error-presentation";

const translate = (key: string) => `localized:${key}`;

describe("presentClientError", () => {
  it.each([
    [401, "unauthenticated"],
    [403, "forbidden"],
    [409, "conflict"],
    [429, "rateLimited"],
    [503, "providerUnavailable"],
  ])("maps HTTP %s without exposing the server message", (status, key) => {
    const result = presentClientError(
      new StudioApiError(status, "provider secret detail"),
      "localized fallback",
      translate,
    );
    expect(result.message).toBe(`localized:${key}`);
    expect(result.message).not.toContain("provider secret detail");
  });

  it("maps known capability codes and exposes only a bounded technical reference", () => {
    const result = presentClientError(
      new StudioApiError(422, "raw provider copy", {
        code: "platform_not_configured",
        operatorTraceRef: "trace_123",
      }),
      "localized fallback",
      translate,
    );
    expect(result).toEqual({
      message: "localized:capabilityUnavailable",
      technicalReference: "platform_not_configured · HTTP:422 · TRACE:trace_123",
    });
  });

  it("uses the authored action fallback for validation and non-API failures", () => {
    expect(
      presentClientError(
        new StudioApiError(422, "untranslated validation text"),
        "localized fallback",
        translate,
      ).message,
    ).toBe("localized fallback");
    expect(
      presentClientError(new Error("raw browser failure"), "localized fallback", translate),
    ).toEqual({ message: "localized fallback", technicalReference: null });
  });

  it("drops unsafe server-controlled codes and trace references", () => {
    const result = presentClientError(
      new StudioApiError(422, "raw", {
        code: "<script>alert(1)</script>",
        operatorTraceRef: "trace with spaces",
      }),
      "localized fallback",
      translate,
    );
    expect(result).toEqual({
      message: "localized fallback",
      technicalReference: "HTTP:422",
    });
  });
});
