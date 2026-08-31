import { describe, expect, it } from "vitest";
import { resolveLocale } from "@/lib/locale";

describe("resolveLocale", () => {
  it("defaults to Arabic when no preference is stored", () => {
    expect(resolveLocale(undefined)).toBe("ar");
  });

  it("keeps Arabic for unknown cookie values", () => {
    expect(resolveLocale("fr")).toBe("ar");
  });

  it("uses English only when explicitly selected", () => {
    expect(resolveLocale("en")).toBe("en");
  });
});
