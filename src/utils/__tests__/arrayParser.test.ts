import { describe, it, expect } from "vitest";
import { parseTextToArray } from "@/utils/arrayParser";

describe("parseTextToArray", () => {
  it("splits by delimiter and trims/removes empty by default flags", () => {
    const result = parseTextToArray(" one * two *  * three ", {
      splitMode: "delimiter",
      delimiter: "*",
      regexPattern: "",
      trimItems: true,
      removeEmpty: true,
    });

    expect(result.error).toBeNull();
    expect(result.items).toEqual(["one", "two", "three"]);
  });

  it("splits by newline", () => {
    const result = parseTextToArray("a\nb\r\nc", {
      splitMode: "newline",
      delimiter: "*",
      regexPattern: "",
      trimItems: true,
      removeEmpty: true,
    });

    expect(result.items).toEqual(["a", "b", "c"]);
  });

  it("splits by regex pattern", () => {
    const result = parseTextToArray("a1b2c3", {
      splitMode: "regex",
      delimiter: "*",
      regexPattern: "\\d",
      trimItems: true,
      removeEmpty: true,
    });

    expect(result.error).toBeNull();
    expect(result.items).toEqual(["a", "b", "c"]);
  });

  it("returns a single item when delimiter is empty", () => {
    const result = parseTextToArray("keep as one", {
      splitMode: "delimiter",
      delimiter: "",
      regexPattern: "",
      trimItems: true,
      removeEmpty: true,
    });

    expect(result.items).toEqual(["keep as one"]);
  });

  it("returns error for invalid regex", () => {
    const result = parseTextToArray("a,b,c", {
      splitMode: "regex",
      delimiter: "*",
      regexPattern: "(",
      trimItems: true,
      removeEmpty: true,
    });

    expect(result.items).toEqual([]);
    expect(result.error).toBeTruthy();
  });

  it("returns error when regex pattern is too long", () => {
    const result = parseTextToArray("a,b,c", {
      splitMode: "regex",
      delimiter: "*",
      regexPattern: "a".repeat(101),
      trimItems: true,
      removeEmpty: true,
    });

    expect(result.items).toEqual([]);
    expect(result.error).toContain("Regex pattern too long");
  });
});
