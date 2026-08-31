import type { SocialPlatform } from "@/lib/db/schema";
import type { PublishMediaItem } from "@/lib/social/provider-interface";

export type NormalizedPublishingSettings = Record<string, unknown>;

export interface PublishingSettingsValidationContext {
  content: string;
  media: PublishMediaItem[];
}

export interface PublishingSettingsValidationResult {
  valid: boolean;
  errors: string[];
}

export interface PublishingSettingsDefinition {
  platform: SocialPlatform;
  label: string;
  defaults: NormalizedPublishingSettings;
  normalize: (
    settings: NormalizedPublishingSettings | null | undefined,
  ) => NormalizedPublishingSettings;
  validateForPublish: (
    settings: NormalizedPublishingSettings | null | undefined,
    context: PublishingSettingsValidationContext,
  ) => PublishingSettingsValidationResult;
}

const youtubeDefinition: PublishingSettingsDefinition = {
  platform: "youtube",
  label: "YouTube",
  defaults: {
    privacyStatus: "private",
    madeForKids: false,
    tags: [],
  },
  normalize(settings) {
    return {
      ...(typeof settings?.title === "string" && settings.title.trim()
        ? { title: settings.title.trim() }
        : {}),
      privacyStatus:
        settings?.privacyStatus === "public" ||
        settings?.privacyStatus === "unlisted"
          ? settings.privacyStatus
          : "private",
      madeForKids: settings?.madeForKids === true,
      tags: Array.isArray(settings?.tags)
        ? settings.tags.filter((tag): tag is string => typeof tag === "string")
        : [],
    };
  },
  validateForPublish(settings) {
    const normalized = this.normalize(settings);
    const errors: string[] = [];
    if (typeof normalized.title !== "string" || !normalized.title.trim()) {
      errors.push("YouTube title is required.");
    }
    return { valid: errors.length === 0, errors };
  },
};

const tiktokPrivacyLevels = new Set([
  "PUBLIC_TO_EVERYONE",
  "MUTUAL_FOLLOW_FRIENDS",
  "FOLLOWER_OF_CREATOR",
  "SELF_ONLY",
]);

const tiktokPostingMethods = new Set(["DIRECT_POST", "UPLOAD"]);

const tiktokDefinition: PublishingSettingsDefinition = {
  platform: "tiktok",
  label: "TikTok",
  defaults: {
    privacyLevel: "SELF_ONLY",
    contentPostingMethod: "UPLOAD",
    allowComments: true,
    allowDuet: false,
    allowStitch: false,
    autoAddMusic: false,
    videoMadeWithAi: false,
    brandedContent: false,
    yourBrand: false,
  },
  normalize(settings) {
    const privacyLevel =
      typeof settings?.privacyLevel === "string" &&
      tiktokPrivacyLevels.has(settings.privacyLevel)
        ? settings.privacyLevel
        : "SELF_ONLY";
    const contentPostingMethod =
      typeof settings?.contentPostingMethod === "string" &&
      tiktokPostingMethods.has(settings.contentPostingMethod)
        ? settings.contentPostingMethod
        : "UPLOAD";

    return {
      privacyLevel,
      contentPostingMethod,
      allowComments: settings?.allowComments !== false,
      allowDuet: settings?.allowDuet === true,
      allowStitch: settings?.allowStitch === true,
      autoAddMusic: settings?.autoAddMusic === true,
      videoMadeWithAi: settings?.videoMadeWithAi === true,
      brandedContent: settings?.brandedContent === true,
      yourBrand: settings?.yourBrand === true,
    };
  },
  validateForPublish(_settings, context) {
    const errors: string[] = [];
    if (context.media.length === 0) {
      errors.push("TikTok requires at least one image or video.");
    }
    return { valid: errors.length === 0, errors };
  },
};

const redditPostTypes = new Set(["self", "link"]);

const redditDefinition: PublishingSettingsDefinition = {
  platform: "reddit",
  label: "Reddit",
  defaults: {
    type: "self",
  },
  normalize(settings) {
    const normalized: NormalizedPublishingSettings = {
      type:
        typeof settings?.type === "string" && redditPostTypes.has(settings.type)
          ? settings.type
          : "self",
    };

    if (typeof settings?.subreddit === "string" && settings.subreddit.trim()) {
      normalized.subreddit = settings.subreddit.trim();
    }
    if (typeof settings?.title === "string" && settings.title.trim()) {
      normalized.title = settings.title.trim();
    }
    if (typeof settings?.url === "string" && settings.url.trim()) {
      normalized.url = settings.url.trim();
    }

    return normalized;
  },
  validateForPublish(settings) {
    const normalized = this.normalize(settings);
    const errors: string[] = [];
    if (
      typeof normalized.subreddit !== "string" ||
      !normalized.subreddit.trim()
    ) {
      errors.push("Reddit subreddit is required.");
    }
    if (typeof normalized.title !== "string" || !normalized.title.trim()) {
      errors.push("Reddit title is required.");
    }
    return { valid: errors.length === 0, errors };
  },
};

const linkedinAuthorTypes = new Set(["person", "organization"]);
const linkedinKeys = new Set(["type"]);

/**
 * LinkedIn settings intentionally have a closed shape. The runtime Publishing
 * Plan validator calls validateForPublish before normalize so misspelled or
 * unsupported provider settings cannot be silently replaced by defaults.
 */
const linkedinDefinition: PublishingSettingsDefinition = {
  platform: "linkedin",
  label: "LinkedIn",
  defaults: {
    type: "person",
  },
  normalize(settings) {
    return {
      type:
        typeof settings?.type === "string" &&
        linkedinAuthorTypes.has(settings.type)
          ? settings.type
          : "person",
    };
  },
  validateForPublish(settings) {
    const value = settings ?? {};
    const errors: string[] = [];
    const unknownKeys = Object.keys(value).filter(
      (key) => !linkedinKeys.has(key),
    );
    if (unknownKeys.length > 0) {
      errors.push(
        `LinkedIn settings contain unsupported fields: ${unknownKeys.sort().join(", ")}.`,
      );
    }
    if (
      value.type !== undefined &&
      (typeof value.type !== "string" || !linkedinAuthorTypes.has(value.type))
    ) {
      errors.push("LinkedIn author type is invalid.");
    }
    return { valid: errors.length === 0, errors };
  },
};

const mastodonVisibilities = new Set(["public", "unlisted", "private", "direct"])

const mastodonDefinition: PublishingSettingsDefinition = {
  platform: "mastodon",
  label: "Mastodon",
  defaults: {
    visibility: "public",
    contentWarning: "",
  },
  normalize(settings) {
    return {
      visibility:
        typeof settings?.visibility === "string" &&
        mastodonVisibilities.has(settings.visibility)
          ? settings.visibility
          : "public",
      contentWarning:
        typeof settings?.contentWarning === "string"
          ? settings.contentWarning.trim()
          : "",
    }
  },
  validateForPublish(_settings, _context) {
    return { valid: true, errors: [] }
  },
}

const definitions = new Map<SocialPlatform, PublishingSettingsDefinition>([
  ["linkedin", linkedinDefinition],
  ["youtube", youtubeDefinition],
  ["tiktok", tiktokDefinition],
  ["reddit", redditDefinition],
  ["mastodon", mastodonDefinition],
]);

export function getPublishingSettingsDefinition(
  platform: SocialPlatform,
): PublishingSettingsDefinition {
  const definition = definitions.get(platform);
  if (!definition) {
    throw new PublishingSettingsDefinitionNotFoundError(platform);
  }
  return definition;
}

export function pickSelectedPublishingSettings(
  selectedChannelIds: string[],
  settingsByChannelId: Record<string, NormalizedPublishingSettings>,
  platformByChannelId: Record<string, SocialPlatform>,
): Record<string, NormalizedPublishingSettings> {
  return selectedChannelIds.reduce<Record<string, NormalizedPublishingSettings>>(
    (acc, channelId) => {
      const platform = platformByChannelId[channelId];
      if (!platform) return acc;

      const definition = definitions.get(platform);
      if (!definition) return acc;

      acc[channelId] = definition.normalize(settingsByChannelId[channelId]);
      return acc;
    },
    {},
  );
}

export function validateSelectedPublishingSettings(input: {
  selectedChannelIds: string[];
  settingsByChannelId: Record<string, NormalizedPublishingSettings>;
  platformByChannelId: Record<string, SocialPlatform>;
  labelByChannelId?: Record<string, string>;
  content: string;
  media: PublishMediaItem[];
}): PublishingSettingsValidationResult {
  const errors: string[] = [];

  for (const channelId of input.selectedChannelIds) {
    const platform = input.platformByChannelId[channelId];
    if (!platform) continue;

    const definition = definitions.get(platform);
    if (!definition) continue;

    const result = definition.validateForPublish(
      input.settingsByChannelId[channelId],
      { content: input.content, media: input.media },
    );
    if (!result.valid) {
      const label = input.labelByChannelId?.[channelId] || definition.label;
      errors.push(...result.errors.map((error) => `${label}: ${error}`));
    }
  }

  return { valid: errors.length === 0, errors };
}

export class PublishingSettingsDefinitionNotFoundError extends Error {
  platform: SocialPlatform;

  constructor(platform: SocialPlatform) {
    super(`Publishing settings are not available for platform "${platform}".`);
    this.name = "PublishingSettingsDefinitionNotFoundError";
    this.platform = platform;
  }
}
