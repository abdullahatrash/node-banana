import { assertIanaTimezone, budgetPeriodWindow } from "../budgets/period";
import type { QuotaWindow, QuotaWindowKind } from "./types";

export function quotaWindow(
  kind: QuotaWindowKind,
  timezoneInput: string,
  at: Date,
): QuotaWindow {
  if (Number.isNaN(at.getTime())) throw new TypeError("Quota evaluation time is invalid.");
  const timezone = assertIanaTimezone(timezoneInput);
  if (kind === "concurrent" || kind === "lifetime") {
    return { kind, timezone, startsAt: new Date(0), endsAt: null };
  }
  if (kind === "calendar_minute" || kind === "calendar_hour") {
    const duration = kind === "calendar_minute" ? 60_000 : 3_600_000;
    const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    }).formatToParts(at).filter((part) => part.type !== "literal").map((part) => [part.type, Number(part.value)]));
    const elapsed = kind === "calendar_minute"
      ? (parts.second ?? 0) * 1_000 + at.getUTCMilliseconds()
      : (parts.minute ?? 0) * 60_000 + (parts.second ?? 0) * 1_000 + at.getUTCMilliseconds();
    const startsAt = new Date(at.getTime() - elapsed);
    return { kind, timezone, startsAt, endsAt: new Date(startsAt.getTime() + duration) };
  }
  const budgetWindow = budgetPeriodWindow(kind, timezone, at);
  return { ...budgetWindow, kind };
}
