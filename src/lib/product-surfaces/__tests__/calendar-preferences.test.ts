import { describe, expect, it } from "vitest";
import { validateCalendarPreferences } from "../calendar-preferences";

describe("Workspace calendar preferences", () => {
  it("accepts an explicit IANA timezone and any configured week start", () => {
    expect(validateCalendarPreferences({ timezone: "Asia/Riyadh", weekStartsOn: 6 })).toEqual({ timezone: "Asia/Riyadh", weekStartsOn: 6 });
    expect(validateCalendarPreferences({ timezone: "Europe/Athens", weekStartsOn: 1 })).toEqual({ timezone: "Europe/Athens", weekStartsOn: 1 });
  });

  it("fails closed for locale guesses, invalid zones, and invalid weekdays", () => {
    expect(() => validateCalendarPreferences({ timezone: "ar", weekStartsOn: 6 })).toThrow("CALENDAR_TIMEZONE_INVALID");
    expect(() => validateCalendarPreferences({ timezone: "UTC", weekStartsOn: 7 })).toThrow("CALENDAR_WEEK_START_INVALID");
  });
});
