import { describe, expect, it } from "vitest";
import {
  getPublishingSettingsDefinition,
  pickSelectedPublishingSettings,
  validateSelectedPublishingSettings,
} from "@/lib/social/publishing-settings";

describe("social/publishing-settings", () => {
  it("provides safe normalized defaults for a YouTube channel", () => {
    const definition = getPublishingSettingsDefinition("youtube");

    expect(definition.normalize(definition.defaults)).toEqual({
      privacyStatus: "private",
      madeForKids: false,
      tags: [],
    });
  });

  it("requires a YouTube title before publishing", () => {
    const definition = getPublishingSettingsDefinition("youtube");

    const result = definition.validateForPublish(definition.defaults, {
      content: "A video description",
      media: [{ type: "video", url: "https://example.com/video.mp4" }],
    });

    expect(result.valid).toBe(false);
    expect(result.errors).toContain("YouTube title is required.");
  });

  it("provides safe normalized defaults for a TikTok channel", () => {
    const definition = getPublishingSettingsDefinition("tiktok");

    expect(definition.normalize(definition.defaults)).toEqual({
      privacyLevel: "SELF_ONLY",
      contentPostingMethod: "UPLOAD",
      allowComments: true,
      allowDuet: false,
      allowStitch: false,
      autoAddMusic: false,
      videoMadeWithAi: false,
      brandedContent: false,
      yourBrand: false,
    });
  });

  it("requires media before publishing to TikTok", () => {
    const definition = getPublishingSettingsDefinition("tiktok");

    const result = definition.validateForPublish(definition.defaults, {
      content: "A TikTok caption",
      media: [],
    });

    expect(result.valid).toBe(false);
    expect(result.errors).toContain("TikTok requires at least one image or video.");
  });

  it("keeps Reddit destination explicit in normalized defaults", () => {
    const definition = getPublishingSettingsDefinition("reddit");

    expect(definition.normalize(definition.defaults)).toEqual({
      type: "self",
    });
  });

  it("requires one Reddit subreddit and title before publishing", () => {
    const definition = getPublishingSettingsDefinition("reddit");

    const result = definition.validateForPublish(definition.defaults, {
      content: "A Reddit post body",
      media: [],
    });

    expect(result.valid).toBe(false);
    expect(result.errors).toEqual([
      "Reddit subreddit is required.",
      "Reddit title is required.",
    ]);
  });

  it("prepares only selected Channel Publishing Settings for saving", () => {
    expect(
      pickSelectedPublishingSettings(
        ["selected-channel"],
        {
          "selected-channel": {
            privacyStatus: "public",
            title: "Selected",
            tags: ["launch"],
          },
          "deselected-channel": {
            privacyStatus: "public",
            title: "Deselected",
          },
        },
        { "selected-channel": "youtube", "deselected-channel": "youtube" },
      ),
    ).toEqual({
      "selected-channel": {
        privacyStatus: "public",
        title: "Selected",
        madeForKids: false,
        tags: ["launch"],
      },
    });
  });

  it("validates selected Channel Publishing Settings with channel labels", () => {
    expect(
      validateSelectedPublishingSettings({
        selectedChannelIds: ["youtube-channel", "reddit-channel"],
        settingsByChannelId: {
          "youtube-channel": { title: "Launch video" },
          "reddit-channel": { title: "Reddit launch" },
        },
        platformByChannelId: {
          "youtube-channel": "youtube",
          "reddit-channel": "reddit",
        },
        labelByChannelId: {
          "youtube-channel": "Studio YouTube",
          "reddit-channel": "Launch Reddit",
        },
        content: "Post body",
        media: [{ type: "video", url: "https://example.com/video.mp4" }],
      }),
    ).toEqual({
      valid: false,
      errors: ["Launch Reddit: Reddit subreddit is required."],
    });
  });
});
