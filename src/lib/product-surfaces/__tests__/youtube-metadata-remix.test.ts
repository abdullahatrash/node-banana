import { afterEach, describe, expect, it, vi } from "vitest";
import { queueYoutubeMetadataRemix } from "../youtube-metadata-remix";

afterEach(() => vi.unstubAllEnvs());

describe("YouTube topic adaptation gate", () => {
  it("fails before database access unless the exact content-adaptation approval gate is configured", async () => {
    vi.stubEnv("YOUTUBE_TREND_DISCOVERY_ENABLED", "true");
    vi.stubEnv("YOUTUBE_DATA_API_KEY", "configured-but-never-returned");
    vi.stubEnv("NEXT_PUBLIC_TERMS_URL", "https://example.com/terms");
    vi.stubEnv("NEXT_PUBLIC_PRIVACY_URL", "https://example.com/privacy");
    vi.stubEnv("YOUTUBE_CONTENT_ADAPTATION_APPROVED", "false");

    await expect(queueYoutubeMetadataRemix({ workspaceId: "workspace-1", userId: "user-1", sourceId: "source-1", videoId: "video-1", contentLanguage: "ar", arabicVariety: "gulf", format: "video_hook_demo", idempotencyKey: "queue-key-1" })).rejects.toMatchObject({ code: "YOUTUBE_CONTENT_ADAPTATION_NOT_APPROVED" });
  });
});
