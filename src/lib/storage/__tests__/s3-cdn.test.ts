import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildCdnDownloadUrl } from "../s3";

describe("buildCdnDownloadUrl", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns null when CDN_BASE_URL is not set", () => {
    const result = buildCdnDownloadUrl({ key: "env/prod/ws/ws_1/test.png" });
    expect(result).toBeNull();
  });

  it("returns correct URL when CDN_BASE_URL is set", () => {
    vi.stubEnv("CDN_BASE_URL", "https://cdn.example.com");

    const result = buildCdnDownloadUrl({ key: "env/prod/ws/ws_1/test.png" });
    expect(result).toBe("https://cdn.example.com/env/prod/ws/ws_1/test.png");
  });

  it("handles trailing slash in base URL", () => {
    vi.stubEnv("CDN_BASE_URL", "https://cdn.example.com/");

    const result = buildCdnDownloadUrl({ key: "env/prod/ws/ws_1/test.png" });
    expect(result).toBe("https://cdn.example.com/env/prod/ws/ws_1/test.png");
  });

  it("handles multiple trailing slashes", () => {
    vi.stubEnv("CDN_BASE_URL", "https://cdn.example.com///");

    const result = buildCdnDownloadUrl({ key: "env/prod/ws/ws_1/test.png" });
    expect(result).toBe("https://cdn.example.com/env/prod/ws/ws_1/test.png");
  });
});
