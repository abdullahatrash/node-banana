import { describe, expect, it } from "vitest";
import {
  LINKEDIN_AUTHOR_KIND_SETTING,
  preserveLinkedInAuthorKind,
  readLinkedInAuthorKind,
  withLinkedInAuthorKind,
} from "../linkedin-author-kind";

describe("LinkedIn server-owned author kind", () => {
  it("records and reads person and organization connections", () => {
    expect(readLinkedInAuthorKind(withLinkedInAuthorKind({}, "person"))).toBe(
      "person",
    );
    expect(
      readLinkedInAuthorKind(withLinkedInAuthorKind({}, "organization")),
    ).toBe("organization");
  });

  it("fails closed for legacy and malformed markers", () => {
    expect(readLinkedInAuthorKind(undefined)).toBeNull();
    expect(
      readLinkedInAuthorKind({ [LINKEDIN_AUTHOR_KIND_SETTING]: "company" }),
    ).toBeNull();
  });

  it("preserves the trusted marker across generic settings replacement", () => {
    expect(
      preserveLinkedInAuthorKind(
        withLinkedInAuthorKind({ old: true }, "organization"),
        { theme: "dark", [LINKEDIN_AUTHOR_KIND_SETTING]: "person" },
      ),
    ).toEqual({
      theme: "dark",
      [LINKEDIN_AUTHOR_KIND_SETTING]: "organization",
    });
  });

  it("does not let generic settings bootstrap a trusted marker", () => {
    expect(
      preserveLinkedInAuthorKind(null, {
        theme: "dark",
        [LINKEDIN_AUTHOR_KIND_SETTING]: "organization",
      }),
    ).toEqual({ theme: "dark" });
  });
});
