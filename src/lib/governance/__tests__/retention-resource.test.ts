import { describe, expect, it } from "vitest";
import { socialPostDescriptor } from "../retention-resource";

describe("authoritative retention resource descriptors", () => {
  it("anchors published lineage age at publication rather than draft creation", () => {
    const createdAt = new Date("2025-01-01T00:00:00.000Z");
    const publishedAt = new Date("2026-09-01T00:00:00.000Z");
    expect(socialPostDescriptor({ id: "post-1", createdAt, publishedAt })).toMatchObject({
      retentionClass: "published_lineage",
      createdAt: publishedAt,
    });
    expect(socialPostDescriptor({ id: "post-2", createdAt, publishedAt: null })).toMatchObject({
      retentionClass: "recoverable_draft",
      createdAt,
    });
  });
});
