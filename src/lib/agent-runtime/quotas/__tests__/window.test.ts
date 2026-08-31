import { describe, expect, it } from "vitest";
import { quotaWindow } from "../window";

describe("Quota windows", () => {
  it("provides exact renewable minute expiry evidence", () => {
    const window = quotaWindow(
      "calendar_minute",
      "America/New_York",
      new Date("2026-03-08T06:30:42.000Z"),
    );
    expect(window.startsAt.toISOString()).toBe("2026-03-08T06:30:00.000Z");
    expect(window.endsAt?.toISOString()).toBe("2026-03-08T06:31:00.000Z");
  });

  it("uses release evidence rather than a fabricated expiry for concurrent capacity", () => {
    expect(quotaWindow("concurrent", "UTC", new Date("2026-03-08T06:30:42.000Z")))
      .toMatchObject({ kind: "concurrent", startsAt: new Date(0), endsAt: null });
  });

  it("aligns an hourly window to a non-whole-hour IANA offset", () => {
    const window = quotaWindow(
      "calendar_hour",
      "Asia/Kathmandu",
      new Date("2026-08-01T06:49:42.000Z"),
    );
    expect(window.startsAt.toISOString()).toBe("2026-08-01T06:15:00.000Z");
    expect(window.endsAt?.toISOString()).toBe("2026-08-01T07:15:00.000Z");
  });

  it("distinguishes both repeated local hours across a DST fallback", () => {
    const first = quotaWindow("calendar_hour", "America/New_York", new Date("2026-11-01T05:30:00.000Z"));
    const second = quotaWindow("calendar_hour", "America/New_York", new Date("2026-11-01T06:30:00.000Z"));
    expect(first.startsAt.toISOString()).toBe("2026-11-01T05:00:00.000Z");
    expect(second.startsAt.toISOString()).toBe("2026-11-01T06:00:00.000Z");
  });
});
