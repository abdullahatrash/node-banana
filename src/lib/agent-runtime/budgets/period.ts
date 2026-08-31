import type { BudgetPeriodKind, BudgetPeriodWindow } from "./types";

interface LocalParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

function formatter(timezone: string): Intl.DateTimeFormat {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
}

export function assertIanaTimezone(timezone: string): string {
  const normalized = timezone.trim();
  if (!normalized || normalized.length > 100) throw new TypeError("Timezone is invalid.");
  try {
    formatter(normalized).format(new Date(0));
  } catch {
    throw new TypeError("Timezone must be an IANA timezone.");
  }
  return normalized;
}

function localParts(at: Date, timezone: string): LocalParts {
  const values = Object.fromEntries(
    formatter(timezone)
      .formatToParts(at)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, Number(part.value)]),
  );
  return {
    year: values.year!,
    month: values.month!,
    day: values.day!,
    hour: values.hour!,
    minute: values.minute!,
    second: values.second!,
  };
}

function localDateToUtc(
  value: Pick<LocalParts, "year" | "month" | "day">,
  timezone: string,
): Date {
  const target = Date.UTC(value.year, value.month - 1, value.day, 0, 0, 0, 0);
  let candidate = target;
  for (let iteration = 0; iteration < 4; iteration += 1) {
    const parts = localParts(new Date(candidate), timezone);
    const represented = Date.UTC(
      parts.year,
      parts.month - 1,
      parts.day,
      parts.hour,
      parts.minute,
      parts.second,
      0,
    );
    const adjustment = target - represented;
    if (adjustment === 0) break;
    candidate += adjustment;
  }
  const result = new Date(candidate);
  const verified = localParts(result, timezone);
  if (
    verified.year !== value.year ||
    verified.month !== value.month ||
    verified.day !== value.day ||
    verified.hour !== 0 ||
    verified.minute !== 0 ||
    verified.second !== 0
  ) {
    throw new TypeError("Budget period boundary is unavailable in this timezone.");
  }
  return result;
}

function addLocalDays(
  value: Pick<LocalParts, "year" | "month" | "day">,
  days: number,
): Pick<LocalParts, "year" | "month" | "day"> {
  const date = new Date(Date.UTC(value.year, value.month - 1, value.day + days));
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
  };
}

export function budgetPeriodWindow(
  kind: BudgetPeriodKind,
  timezoneInput: string,
  at: Date,
): BudgetPeriodWindow {
  if (Number.isNaN(at.getTime())) throw new TypeError("Budget evaluation time is invalid.");
  const timezone = assertIanaTimezone(timezoneInput);
  if (kind === "lifetime") {
    return {
      kind,
      timezone,
      startsAt: new Date("1970-01-01T00:00:00.000Z"),
      endsAt: null,
    };
  }
  const local = localParts(at, timezone);
  let start = { year: local.year, month: local.month, day: local.day };
  let end: typeof start;
  if (kind === "calendar_week") {
    const weekday = new Date(Date.UTC(start.year, start.month - 1, start.day)).getUTCDay();
    start = addLocalDays(start, -(weekday === 0 ? 6 : weekday - 1));
    end = addLocalDays(start, 7);
  } else if (kind === "calendar_month") {
    start = { year: start.year, month: start.month, day: 1 };
    const next = new Date(Date.UTC(start.year, start.month, 1));
    end = {
      year: next.getUTCFullYear(),
      month: next.getUTCMonth() + 1,
      day: 1,
    };
  } else {
    end = addLocalDays(start, 1);
  }
  return {
    kind,
    timezone,
    startsAt: localDateToUtc(start, timezone),
    endsAt: localDateToUtc(end, timezone),
  };
}
