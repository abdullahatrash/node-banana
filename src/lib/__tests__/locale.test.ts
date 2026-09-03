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

  it("uses the committed locale precedence", () => {
    expect(resolveLocale({ sessionLocale: "en", preferenceLocale: "ar" })).toBe("en");
    expect(resolveLocale({ preferenceLocale: "en", workspaceLocale: "ar" })).toBe("en");
    expect(resolveLocale({ workspaceLocale: "en", cookieLocale: "ar" })).toBe("en");
    expect(resolveLocale({ cookieLocale: "en", acceptLanguage: "ar-SA" })).toBe("en");
  });

  it("uses supported browser language before the Arabic fallback", () => {
    expect(resolveLocale({ acceptLanguage: "fr-FR,en;q=0.8" })).toBe("en");
    expect(resolveLocale({ acceptLanguage: "ar-EG,en;q=0.8" })).toBe("ar");
    expect(resolveLocale({ acceptLanguage: "en-US,ar;q=0.1" })).toBe("en");
    expect(resolveLocale({ acceptLanguage: "ar;q=0,en;q=0.5" })).toBe("en");
    expect(resolveLocale({ acceptLanguage: "fr-FR" })).toBe("ar");
  });
});
