import type { SocialPlatform } from "@/lib/db/schema";
import { getPublishingSettingsDefinition } from "@/lib/social/publishing-settings";

export interface CopilotPublishingSettingsSchema {
  platform: SocialPlatform;
  label: string;
  /** Safe Defaults — also reveals the available field names for this platform. */
  defaults: Record<string, unknown>;
}

/**
 * Return the per-platform Publishing Settings schema (label + Safe Defaults) for
 * the copilot, or null when the platform has no extra settings. Backs the
 * `getPublishingSettingsSchema` tool.
 */
export function getPublishingSettingsSchema(
  platform: SocialPlatform,
): CopilotPublishingSettingsSchema | null {
  try {
    const def = getPublishingSettingsDefinition(platform);
    return { platform: def.platform, label: def.label, defaults: def.defaults };
  } catch {
    return null;
  }
}
