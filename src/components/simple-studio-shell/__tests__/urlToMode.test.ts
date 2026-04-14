import { describe, expect, it } from "vitest";
import {
  URL_SEGMENT_TO_MODE,
  MODE_TO_URL_SEGMENT,
  modeFromPathname,
} from "../urlToMode";

describe("urlToMode", () => {
  describe("URL_SEGMENT_TO_MODE", () => {
    it("maps images → photo", () => {
      expect(URL_SEGMENT_TO_MODE.images).toBe("photo");
    });
    it("maps videos → video", () => {
      expect(URL_SEGMENT_TO_MODE.videos).toBe("video");
    });
    it("maps copy → copy", () => {
      expect(URL_SEGMENT_TO_MODE.copy).toBe("copy");
    });
  });

  describe("MODE_TO_URL_SEGMENT", () => {
    it("is the inverse of URL_SEGMENT_TO_MODE", () => {
      expect(MODE_TO_URL_SEGMENT.photo).toBe("images");
      expect(MODE_TO_URL_SEGMENT.video).toBe("videos");
      expect(MODE_TO_URL_SEGMENT.copy).toBe("copy");
    });
  });

  describe("modeFromPathname", () => {
    it("returns photo for /simple-studio/images", () => {
      expect(modeFromPathname("/simple-studio/images")).toBe("photo");
    });
    it("returns video for /simple-studio/videos", () => {
      expect(modeFromPathname("/simple-studio/videos")).toBe("video");
    });
    it("returns copy for /simple-studio/copy", () => {
      expect(modeFromPathname("/simple-studio/copy")).toBe("copy");
    });
    it("handles trailing segments", () => {
      expect(modeFromPathname("/simple-studio/images/")).toBe("photo");
    });
    it("returns null for /simple-studio/library", () => {
      expect(modeFromPathname("/simple-studio/library")).toBeNull();
    });
    it("returns null for /simple-studio/prompt-library", () => {
      expect(modeFromPathname("/simple-studio/prompt-library")).toBeNull();
    });
    it("returns null for /simple-studio", () => {
      expect(modeFromPathname("/simple-studio")).toBeNull();
    });
    it("returns null for unrelated paths", () => {
      expect(modeFromPathname("/studio/simple")).toBeNull();
      expect(modeFromPathname("/social/calendar")).toBeNull();
    });
  });
});
