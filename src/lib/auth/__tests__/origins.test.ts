import { describe, expect, it } from "vitest";
import {
  getAuthClientBaseURL,
  getAuthServerBaseURL,
} from "@/lib/auth/origins";

describe("auth origin configuration", () => {
  it("uses the browser origin for a local auth client", () => {
    expect(
      getAuthClientBaseURL("http://localhost:3000", false),
    ).toBeUndefined();
    expect(
      getAuthClientBaseURL("http://127.0.0.1:3000", false),
    ).toBeUndefined();
  });

  it("keeps an explicit auth origin outside local development", () => {
    expect(
      getAuthClientBaseURL("https://app.example.com", false),
    ).toBe("https://app.example.com");
    expect(
      getAuthClientBaseURL("http://localhost:3000", true),
    ).toBe("http://localhost:3000");
  });

  it("allows the active localhost port to define the development server URL", () => {
    expect(
      getAuthServerBaseURL("http://localhost:3000", false),
    ).toEqual({
      allowedHosts: ["localhost:*", "127.0.0.1:*", "[::1]:*"],
      protocol: "auto",
      fallback: "http://localhost:3000",
    });
  });

  it("requires and preserves a fixed production server URL", () => {
    expect(
      getAuthServerBaseURL("https://app.example.com", true),
    ).toBe("https://app.example.com");
    expect(() => getAuthServerBaseURL(undefined, true)).toThrow(
      "BETTER_AUTH_URL",
    );
  });
});
