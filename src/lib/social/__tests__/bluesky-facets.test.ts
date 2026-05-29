import { describe, expect, it, vi } from "vitest"
import { detectFacets, graphemeLength } from "@/lib/social/bluesky-facets"

const mockResolveHandle = vi.fn()

describe("detectFacets", () => {
  it("detects a URL and returns a link facet", async () => {
    const text = "Check out https://example.com for more"
    const facets = await detectFacets(text, mockResolveHandle)
    expect(facets).toHaveLength(1)
    expect(facets[0].features[0].$type).toBe("app.bsky.richtext.facet#link")
    expect((facets[0].features[0] as { uri: string }).uri).toBe("https://example.com")
    const encoder = new TextEncoder()
    const bytes = encoder.encode(text)
    const slice = bytes.slice(facets[0].index.byteStart, facets[0].index.byteEnd)
    expect(new TextDecoder().decode(slice)).toBe("https://example.com")
  })

  it("detects a mention and resolves to DID", async () => {
    mockResolveHandle.mockResolvedValueOnce("did:plc:abc123")
    const text = "Hello @alice.bsky.social how are you?"
    const facets = await detectFacets(text, mockResolveHandle)
    expect(facets).toHaveLength(1)
    expect(facets[0].features[0].$type).toBe("app.bsky.richtext.facet#mention")
    expect((facets[0].features[0] as { did: string }).did).toBe("did:plc:abc123")
    expect(mockResolveHandle).toHaveBeenCalledWith("alice.bsky.social")
  })

  it("skips mentions that fail to resolve", async () => {
    mockResolveHandle.mockRejectedValueOnce(new Error("not found"))
    const text = "Hello @nonexistent.bsky.social"
    const facets = await detectFacets(text, mockResolveHandle)
    expect(facets).toHaveLength(0)
  })

  it("detects a hashtag", async () => {
    const text = "Love this #photography"
    const facets = await detectFacets(text, mockResolveHandle)
    expect(facets).toHaveLength(1)
    expect(facets[0].features[0].$type).toBe("app.bsky.richtext.facet#tag")
    expect((facets[0].features[0] as { tag: string }).tag).toBe("photography")
  })

  it("detects multiple facets in one string", async () => {
    mockResolveHandle.mockResolvedValueOnce("did:plc:xyz")
    const text = "@bob.bsky.social check https://example.com #cool"
    const facets = await detectFacets(text, mockResolveHandle)
    expect(facets).toHaveLength(3)
  })

  it("computes correct byte offsets for emoji-containing text", async () => {
    const text = "🎉 https://example.com"
    const facets = await detectFacets(text, mockResolveHandle)
    expect(facets).toHaveLength(1)
    const encoder = new TextEncoder()
    const bytes = encoder.encode(text)
    const slice = bytes.slice(facets[0].index.byteStart, facets[0].index.byteEnd)
    expect(new TextDecoder().decode(slice)).toBe("https://example.com")
  })

  it("returns empty array for plain text", async () => {
    const facets = await detectFacets("Hello world", mockResolveHandle)
    expect(facets).toHaveLength(0)
  })

  it("does not include the # in the tag value", async () => {
    const text = "Love #photography"
    const facets = await detectFacets(text, mockResolveHandle)
    expect((facets[0].features[0] as { tag: string }).tag).toBe("photography")
  })
})

describe("graphemeLength", () => {
  it("counts ASCII characters", () => {
    expect(graphemeLength("hello")).toBe(5)
  })

  it("counts emoji as single graphemes", () => {
    expect(graphemeLength("🎉")).toBe(1)
    expect(graphemeLength("👨‍👩‍👧‍👦")).toBe(1)
  })

  it("counts mixed text correctly", () => {
    expect(graphemeLength("Hi 🎉!")).toBe(5)
  })
})
