import { describe, expect, it, vi } from "vitest";
import { createTranslator } from "next-intl";
import { directionForText, isolateAuto, isolateLtr } from "../bidi";
import { catalogs, validateCatalogs } from "../catalog";
import { getDirection, getPublicLocaleFromPath } from "../config";
import { canonicalizeErrorCode, getLocalizedErrorMessage } from "../errors";
import { getAuthoredMessageFallback } from "../fallback";
import { formatCurrency, formatDate, formatDateWithOptionalHijri, formatNumber, formatUnit } from "../format";
import { renderNotification } from "../notifications";
import { pseudoLocalize } from "../pseudo";
import { reportLocalizationIncident } from "../incidents";
import { normalizeArabicSearch, parseLocalizedSearchQuery } from "../search";

describe("Arabic-first i18n foundation", () => {
  it("keeps Arabic and English catalogs structurally identical", () => {
    expect(validateCatalogs()).toEqual([]);
  });

  it("derives direction and public locale paths", () => {
    expect(getDirection("ar")).toBe("rtl");
    expect(getDirection("en")).toBe("ltr");
    expect(getPublicLocaleFromPath("/ar/guide")).toBe("ar");
    expect(getPublicLocaleFromPath("/dashboard")).toBeNull();
  });

  it("supports explicit Arabic-Indic and Latin digits", () => {
    expect(formatNumber(1234, { locale: "ar", numeralSystem: "arab" })).toMatch(/[١٢٣٤]/);
    expect(formatNumber(1234, { locale: "ar", numeralSystem: "latn" })).toMatch(/[1234]/);
    expect(formatCurrency(25, "SAR", { locale: "ar", numeralSystem: "latn" })).toContain("25");
    expect(formatUnit(12, "megabyte", { locale: "en" })).toContain("12");
    expect(formatDate("2026-09-03T12:00:00Z", { locale: "en", timeZone: "UTC" })).toContain("2026");
    const companion = formatDateWithOptionalHijri("2026-09-03T12:00:00Z", {
      locale: "ar",
      numeralSystem: "arab",
      timeZone: "Asia/Riyadh",
      calendarPresentation: "gregorian-with-hijri",
    });
    expect(companion.gregorian).not.toBe(companion.hijri);
    expect(companion.hijri).toMatch(/[١-٩]/);
  });

  it("uses authored ICU plural, gender, and interpolation rules", () => {
    const ar = createTranslator({ locale: "ar", messages: catalogs.ar, namespace: "common" });
    const en = createTranslator({ locale: "en", messages: catalogs.en, namespace: "common" });
    expect(ar("selectionSummary", { count: 2 })).toContain("عنصرين");
    expect(en("selectionSummary", { count: 3 })).toBe("3 items selected");
    expect(ar("actorGreeting", { gender: "female", name: isolateLtr("Nora-7") })).toContain("بالسيدة");
  });

  it("isolates mixed-direction interpolations", () => {
    expect(isolateLtr("user@example.com")).toBe("\u2066user@example.com\u2069");
    expect(isolateAuto("Tasmeemai تصميمي")).toBe("\u2068Tasmeemai تصميمي\u2069");
    expect(directionForText("تصميمي Tasmeemai")).toBe("rtl");
    expect(directionForText("Tasmeemai تصميمي")).toBe("ltr");
  });

  it("normalizes Arabic discovery search without changing quoted exact queries", () => {
    expect(normalizeArabicSearch("  إِعْــــلان  عَلَى  ")).toBe("اعلان علي");
    expect(parseLocalizedSearchQuery('"إعلان"')).toEqual({
      exact: "إعلان",
      normalized: "إعلان",
      mode: "exact",
      normalizationApplied: false,
    });
    expect(parseLocalizedSearchQuery("إِعْلان").normalizationApplied).toBe(true);
  });

  it("falls back to the other authored catalog without exposing a missing key", () => {
    expect(getAuthoredMessageFallback("ar", "common", "account")).toEqual({
      locale: "en",
      message: "Account",
    });
    expect(getAuthoredMessageFallback("en", "missing", "raw.semantic.key").message)
      .toBe("تعذر عرض النص");
  });

  it("emits a structured high-severity incident without customer content", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    reportLocalizationIncident({
      locale: "ar",
      fallbackLocale: "en",
      route: "/dashboard",
      key: "shell.routes.missing",
      errorCode: "MISSING_MESSAGE",
    });
    expect(error).toHaveBeenCalledWith("[localization-incident]", expect.objectContaining({
      severity: "high",
      code: "LOCALIZATION_MESSAGE_FAILURE",
      route: "/dashboard",
      key: "shell.routes.missing",
    }));
    error.mockRestore();
  });

  it("maps canonical capability errors to authored messages", () => {
    expect(canonicalizeErrorCode("CAPABILITY_NOT_AUTHORIZED")).toBe("FORBIDDEN");
    expect(getLocalizedErrorMessage("ar", "CAPABILITY_NOT_AUTHORIZED")).toContain("الإذن");
    expect(getLocalizedErrorMessage("en", "UNRECOGNIZED_INTERNAL_CODE"))
      .toBe("Something went wrong. Please try again.");
  });

  it("pins notification locale and catalog version for deterministic retries", () => {
    expect(renderNotification("ar", "catalog-v7", {
      event: "generation.ready",
      name: isolateLtr("Launch-01"),
    })).toMatchObject({ locale: "ar", catalogVersion: "catalog-v7", title: "محتواك جاهز" });
  });

  it("provides a long-string pseudolocalization harness", () => {
    const source = "Review content before publishing";
    const pseudo = pseudoLocalize(source);
    expect(pseudo).toMatch(/^［!!/);
    expect(pseudo.length).toBeGreaterThan(source.length * 1.2);
  });
});
