import { describe, expect, it } from "vitest";
import { validateWorkspaceContentLanguage } from "../workspace-language-preferences";

describe("Workspace content language", () => {
  it("accepts only generation languages supported across Brand, Blitz, and Campaigns", () => {
    expect(validateWorkspaceContentLanguage("ar")).toBe("ar");
    expect(validateWorkspaceContentLanguage("en")).toBe("en");
    expect(validateWorkspaceContentLanguage("ar-SA")).toBe("ar");
    expect(validateWorkspaceContentLanguage("en-GB")).toBe("en");
    expect(() => validateWorkspaceContentLanguage("mixed")).toThrow("CONTENT_LANGUAGE_INVALID");
    expect(() => validateWorkspaceContentLanguage("fr")).toThrow("CONTENT_LANGUAGE_INVALID");
  });
});
