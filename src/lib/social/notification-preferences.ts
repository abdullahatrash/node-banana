import type { AppLocale } from "@/i18n/config";
import type { SocialEventType } from "@/lib/db/schema";

export const SOCIAL_NOTIFICATION_CATEGORIES = ["publishingProgress", "publishingSuccess", "channelUpdates"] as const;
export type SocialNotificationCategory = (typeof SOCIAL_NOTIFICATION_CATEGORIES)[number];
export type SocialNotificationDigestCadence = "daily" | "weekly";

export type SocialNotificationPreferencesDocument = {
  schema: "social-notification-preferences/v1";
  deliveryLocale: AppLocale;
  digestCadence: SocialNotificationDigestCadence;
  weeklyDigestDay: number;
  quietHours: {
    enabled: boolean;
    start: string;
    end: string;
    timeZone: string;
  };
  categories: Record<SocialNotificationCategory, boolean>;
};

const CRITICAL_EVENTS = new Set<SocialEventType>(["post.failed", "dispatch.failed", "account.reauth_required"]);
const EVENT_CATEGORY: Partial<Record<SocialEventType, SocialNotificationCategory>> = {
  "post.queued": "publishingProgress",
  "post.publishing": "publishingProgress",
  "post.published": "publishingSuccess",
  "token.refreshed": "channelUpdates",
};
const TIME = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function defaultSocialNotificationPreferences(input: { locale?: AppLocale; timeZone?: string } = {}): SocialNotificationPreferencesDocument {
  return {
    schema: "social-notification-preferences/v1",
    deliveryLocale: input.locale ?? "ar",
    digestCadence: "daily",
    weeklyDigestDay: 0,
    quietHours: { enabled: true, start: "22:00", end: "08:00", timeZone: validTimeZone(input.timeZone) ? input.timeZone! : "UTC" },
    categories: { publishingProgress: true, publishingSuccess: true, channelUpdates: true },
  };
}

export function readSocialNotificationPreferencesDocument(value: unknown, fallback: { locale?: AppLocale; timeZone?: string } = {}): SocialNotificationPreferencesDocument {
  try { return validateSocialNotificationPreferencesDocument(value); }
  catch { return defaultSocialNotificationPreferences(fallback); }
}

export function validateSocialNotificationPreferencesDocument(value: unknown): SocialNotificationPreferencesDocument {
  if (!record(value) || value.schema !== "social-notification-preferences/v1") throw new Error("NOTIFICATION_PREFERENCES_INVALID");
  if (value.deliveryLocale !== "ar" && value.deliveryLocale !== "en") throw new Error("NOTIFICATION_PREFERENCES_INVALID");
  if (value.digestCadence !== "daily" && value.digestCadence !== "weekly") throw new Error("NOTIFICATION_PREFERENCES_INVALID");
  if (!Number.isInteger(value.weeklyDigestDay) || Number(value.weeklyDigestDay) < 0 || Number(value.weeklyDigestDay) > 6) throw new Error("NOTIFICATION_PREFERENCES_INVALID");
  if (!record(value.quietHours) || typeof value.quietHours.enabled !== "boolean" || !TIME.test(String(value.quietHours.start)) || !TIME.test(String(value.quietHours.end)) || value.quietHours.start === value.quietHours.end || !validTimeZone(value.quietHours.timeZone)) throw new Error("NOTIFICATION_PREFERENCES_INVALID");
  const categories = value.categories;
  if (!record(categories) || SOCIAL_NOTIFICATION_CATEGORIES.some((category) => typeof categories[category] !== "boolean")) throw new Error("NOTIFICATION_PREFERENCES_INVALID");
  return {
    schema: "social-notification-preferences/v1",
    deliveryLocale: value.deliveryLocale,
    digestCadence: value.digestCadence,
    weeklyDigestDay: Number(value.weeklyDigestDay),
    quietHours: { enabled: value.quietHours.enabled, start: String(value.quietHours.start), end: String(value.quietHours.end), timeZone: String(value.quietHours.timeZone) },
    categories: Object.fromEntries(SOCIAL_NOTIFICATION_CATEGORIES.map((category) => [category, categories[category]])) as Record<SocialNotificationCategory, boolean>,
  };
}

export function isCriticalSocialNotification(eventType: SocialEventType): boolean {
  return CRITICAL_EVENTS.has(eventType);
}

export function isOptionalSocialNotificationEnabled(eventType: SocialEventType, preferences: SocialNotificationPreferencesDocument): boolean {
  const category = EVENT_CATEGORY[eventType];
  return category ? preferences.categories[category] : false;
}

export function isEmailDigestDue(preferences: SocialNotificationPreferencesDocument, at = new Date()): boolean {
  const local = localClock(at, preferences.quietHours.timeZone);
  if (preferences.digestCadence === "weekly" && local.weekday !== preferences.weeklyDigestDay) return false;
  if (!preferences.quietHours.enabled) return true;
  const start = minutes(preferences.quietHours.start);
  const end = minutes(preferences.quietHours.end);
  const quiet = start < end ? local.minute >= start && local.minute < end : local.minute >= start || local.minute < end;
  return !quiet;
}

export function buildSocialNotificationPreferenceUpdate(input: { inAppEnabled?: boolean; emailEnabled?: boolean; webhookEnabled?: boolean; muteAll?: boolean; preferences?: Record<string, unknown> | null }, updatedAt: Date) {
  return {
    ...(input.inAppEnabled !== undefined ? { inAppEnabled: input.inAppEnabled } : {}),
    ...(input.emailEnabled !== undefined ? { emailEnabled: input.emailEnabled } : {}),
    ...(input.webhookEnabled !== undefined ? { webhookEnabled: input.webhookEnabled } : {}),
    ...(input.muteAll !== undefined ? { muteAll: input.muteAll } : {}),
    ...(input.preferences !== undefined ? { preferences: input.preferences } : {}),
    updatedAt,
  };
}

function localClock(at: Date, timeZone: string): { weekday: number; minute: number } {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(at);
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? "";
  return { weekday: Math.max(0, WEEKDAYS.indexOf(value("weekday"))), minute: Number(value("hour")) * 60 + Number(value("minute")) };
}

function minutes(value: string): number { const [hour, minute] = value.split(":").map(Number); return hour * 60 + minute; }
function record(value: unknown): value is Record<string, unknown> { return Boolean(value) && typeof value === "object" && !Array.isArray(value); }
function validTimeZone(value: unknown): value is string { if (typeof value !== "string" || !value.trim()) return false; try { new Intl.DateTimeFormat("en", { timeZone: value }).format(); return true; } catch { return false; } }
