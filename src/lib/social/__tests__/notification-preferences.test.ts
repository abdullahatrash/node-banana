import { describe, expect, it } from "vitest";
import { buildSocialNotificationPreferenceUpdate, defaultSocialNotificationPreferences, isCriticalSocialNotification, isEmailDigestDue, isOptionalSocialNotificationEnabled, readSocialNotificationPreferencesDocument, validateSocialNotificationPreferencesDocument } from "../notification-preferences";

describe("social notification preferences", () => {
  it("validates the authored delivery contract and safely repairs legacy JSON", () => {
    const defaults = defaultSocialNotificationPreferences({ locale: "en", timeZone: "Asia/Dubai" });
    expect(validateSocialNotificationPreferencesDocument(defaults)).toEqual(defaults);
    expect(readSocialNotificationPreferencesDocument({ severities: ["error"] }, { locale: "en", timeZone: "Asia/Dubai" })).toEqual(defaults);
    expect(() => validateSocialNotificationPreferencesDocument({ ...defaults, deliveryLocale: "fr" })).toThrow("NOTIFICATION_PREFERENCES_INVALID");
    expect(() => validateSocialNotificationPreferencesDocument({ ...defaults, quietHours: { ...defaults.quietHours, timeZone: "Mars/Olympus" } })).toThrow("NOTIFICATION_PREFERENCES_INVALID");
  });

  it("keeps critical failures mandatory while optional categories remain selectable", () => {
    const preferences = defaultSocialNotificationPreferences();
    preferences.categories.publishingSuccess = false;
    expect(isCriticalSocialNotification("post.failed")).toBe(true);
    expect(isCriticalSocialNotification("account.reauth_required")).toBe(true);
    expect(isOptionalSocialNotificationEnabled("post.published", preferences)).toBe(false);
    expect(isOptionalSocialNotificationEnabled("post.queued", preferences)).toBe(true);
  });

  it("applies weekly cadence and overnight quiet hours in the authored timezone", () => {
    const preferences = defaultSocialNotificationPreferences({ timeZone: "Asia/Riyadh" });
    preferences.digestCadence = "weekly";
    preferences.weeklyDigestDay = 0;
    expect(isEmailDigestDue(preferences, new Date("2026-09-06T10:00:00.000Z"))).toBe(true);
    expect(isEmailDigestDue(preferences, new Date("2026-09-07T10:00:00.000Z"))).toBe(false);
    expect(isEmailDigestDue({ ...preferences, digestCadence: "daily" }, new Date("2026-09-06T20:00:00.000Z"))).toBe(false);
  });

  it("does not reset unrelated channels during a partial update", () => {
    const updatedAt = new Date("2026-09-04T12:00:00.000Z");
    expect(buildSocialNotificationPreferenceUpdate({ muteAll: true }, updatedAt)).toEqual({ muteAll: true, updatedAt });
    expect(buildSocialNotificationPreferenceUpdate({ preferences: null }, updatedAt)).toEqual({ preferences: null, updatedAt });
  });
});
