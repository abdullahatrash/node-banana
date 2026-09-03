import { describe, expect, it } from "vitest";
import { classifyContentLanguage } from "../studio-generation-client";

describe("Simple Studio content-language classification", () => {
  it("distinguishes Arabic, English, and materially mixed prompts", () => {
    expect(classifyContentLanguage("إعلان لمنتج جديد")).toBe("ar");
    expect(classifyContentLanguage("A new product campaign")).toBe("en");
    expect(classifyContentLanguage("Launch العرض الجديد today")).toBe("mixed");
  });
  it("does not call a prompt mixed for a short borrowed token", () => {
    expect(classifyContentLanguage("حملة عربية جديدة AI")).toBe("ar");
    expect(classifyContentLanguage("New campaign ع")).toBe("en");
  });
});
