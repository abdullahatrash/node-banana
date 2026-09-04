import { canonicalDigest } from "@/lib/agent-tools/canonical";
import type { ContentFormat } from "./definitions";

export interface CampaignScheduleDefinition {
  timezone: string;
  weekStart: number;
  postsPerWeek: number;
  startAt: string | null;
  endAt: string | null;
}

export interface CampaignOccurrencePlan {
  occurrenceKey: string;
  scheduledAt: Date;
  format: ContentFormat;
  ordinal: number;
}

const dateParts = (date: Date, timezone: string) => {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit", weekday: "short", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? "";
  return { year: Number(value("year")), month: Number(value("month")), day: Number(value("day")), weekday: value("weekday"), hour: Number(value("hour")), minute: Number(value("minute")), second: Number(value("second")) };
};

function localToUtc(input: { year: number; month: number; day: number; hour: number }, timezone: string) {
  let candidate = new Date(Date.UTC(input.year, input.month - 1, input.day, input.hour));
  for (let attempt = 0; attempt < 3; attempt++) {
    const actual = dateParts(candidate, timezone);
    const desiredEpoch = Date.UTC(input.year, input.month - 1, input.day, input.hour);
    const actualEpoch = Date.UTC(actual.year, actual.month - 1, actual.day, actual.hour, actual.minute, actual.second);
    candidate = new Date(candidate.getTime() + desiredEpoch - actualEpoch);
  }
  return candidate;
}

const weekdayNumber: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

function localWeekStart(date: Date, timezone: string, weekStart: number) {
  const parts = dateParts(date, timezone);
  const day = new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
  day.setUTCDate(day.getUTCDate() - ((weekdayNumber[parts.weekday]! - weekStart + 7) % 7));
  return day;
}

function weightedFormats(formatMix: Partial<Record<ContentFormat, number>>) {
  const entries = Object.entries(formatMix).filter((entry): entry is [ContentFormat, number] => typeof entry[1] === "number" && entry[1] > 0).sort(([left], [right]) => left.localeCompare(right));
  const total = entries.reduce((sum, [, weight]) => sum + weight, 0); const scores = new Map(entries.map(([format]) => [format, 0])); const result: ContentFormat[] = [];
  for (let slot = 0; slot < total; slot++) {
    for (const [format, weight] of entries) scores.set(format, scores.get(format)! + weight);
    const selected = entries.reduce((best, [format]) => scores.get(format)! > scores.get(best)! ? format : best, entries[0]![0]);
    result.push(selected); scores.set(selected, scores.get(selected)! - total);
  }
  return result;
}

/** Produces a bounded, deterministic schedule from the immutable campaign revision. */
export function planCampaignOccurrences(input: {
  campaignId: string;
  campaignRevision: number;
  cadence: CampaignScheduleDefinition;
  formatMix: Partial<Record<ContentFormat, number>>;
  from: Date;
  through: Date;
  maximumHorizonDays?: number;
}): CampaignOccurrencePlan[] {
  const maximumHorizonDays = Math.min(31, Math.max(1, input.maximumHorizonDays ?? 14));
  if (!Number.isInteger(input.cadence.weekStart) || input.cadence.weekStart < 0 || input.cadence.weekStart > 6) throw new Error("CAMPAIGN_WEEK_START_INVALID");
  if (!Number.isInteger(input.cadence.postsPerWeek) || input.cadence.postsPerWeek < 1 || input.cadence.postsPerWeek > 100) throw new Error("CAMPAIGN_FREQUENCY_INVALID");
  try { new Intl.DateTimeFormat("en", { timeZone: input.cadence.timezone }).format(input.from); } catch { throw new Error("CAMPAIGN_TIMEZONE_INVALID"); }
  const hardEnd = new Date(input.from.getTime() + maximumHorizonDays * 86_400_000);
  const configuredEnd = input.cadence.endAt ? new Date(input.cadence.endAt) : hardEnd;
  const through = new Date(Math.min(input.through.getTime(), hardEnd.getTime(), configuredEnd.getTime()));
  const start = input.cadence.startAt ? new Date(Math.max(input.from.getTime(), new Date(input.cadence.startAt).getTime())) : input.from;
  const formats = weightedFormats(input.formatMix); if (!formats.length) throw new Error("CAMPAIGN_FORMAT_MIX_INVALID");
  const firstWeek = localWeekStart(start, input.cadence.timezone, input.cadence.weekStart);
  const plans: CampaignOccurrencePlan[] = [];
  let ordinal = 0;
  for (let week = new Date(firstWeek); plans.length < 200; week.setUTCDate(week.getUTCDate() + 7)) {
    const weekBoundary = localToUtc({ year: week.getUTCFullYear(), month: week.getUTCMonth() + 1, day: week.getUTCDate(), hour: 10 }, input.cadence.timezone);
    if (weekBoundary > through) break;
    for (let slot = 0; slot < input.cadence.postsPerWeek && plans.length < 200; slot++) {
      const localDay = new Date(week); localDay.setUTCDate(localDay.getUTCDate() + Math.floor(slot * 7 / input.cadence.postsPerWeek));
      const scheduledAt = localToUtc({ year: localDay.getUTCFullYear(), month: localDay.getUTCMonth() + 1, day: localDay.getUTCDate(), hour: 10 + (slot % 4) * 2 }, input.cadence.timezone);
      if (scheduledAt < start || scheduledAt > through) continue;
      const format = formats[ordinal % formats.length]!;
      const facts = { campaignId: input.campaignId, campaignRevision: input.campaignRevision, scheduledAt: scheduledAt.toISOString(), format, timezone: input.cadence.timezone };
      plans.push({ occurrenceKey: `campaign-occurrence:${canonicalDigest(facts).slice(7, 39)}`, scheduledAt, format, ordinal }); ordinal++;
    }
  }
  return plans;
}
