export interface BlueskyFacet {
  index: { byteStart: number; byteEnd: number }
  features: Array<
    | { $type: "app.bsky.richtext.facet#link"; uri: string }
    | { $type: "app.bsky.richtext.facet#mention"; did: string }
    | { $type: "app.bsky.richtext.facet#tag"; tag: string }
  >
}

export type HandleResolver = (handle: string) => Promise<string>

const URL_REGEX = /https?:\/\/[^\s)\]}>,"]+/g
const MENTION_REGEX = /(?<=^|[\s([{<])@([a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/g
const HASHTAG_REGEX = /(?<=^|[\s([{<])#([a-zA-Z0-9_À-ɏ]+)/g

function utf8ByteOffset(text: string, charIndex: number): number {
  const encoder = new TextEncoder()
  return encoder.encode(text.slice(0, charIndex)).byteLength
}

export async function detectFacets(
  text: string,
  resolveHandle: HandleResolver,
): Promise<BlueskyFacet[]> {
  const facets: BlueskyFacet[] = []

  for (const match of text.matchAll(URL_REGEX)) {
    const start = match.index!
    const end = start + match[0].length
    facets.push({
      index: {
        byteStart: utf8ByteOffset(text, start),
        byteEnd: utf8ByteOffset(text, end),
      },
      features: [{ $type: "app.bsky.richtext.facet#link", uri: match[0] }],
    })
  }

  for (const match of text.matchAll(MENTION_REGEX)) {
    const handle = match[1]
    const fullMatch = `@${handle}`
    const start = match.index!
    const end = start + fullMatch.length
    try {
      const did = await resolveHandle(handle)
      facets.push({
        index: {
          byteStart: utf8ByteOffset(text, start),
          byteEnd: utf8ByteOffset(text, end),
        },
        features: [{ $type: "app.bsky.richtext.facet#mention", did }],
      })
    } catch {
      // skip unresolvable mentions
    }
  }

  for (const match of text.matchAll(HASHTAG_REGEX)) {
    const tag = match[1]
    const fullMatch = `#${tag}`
    const start = match.index!
    const end = start + fullMatch.length
    facets.push({
      index: {
        byteStart: utf8ByteOffset(text, start),
        byteEnd: utf8ByteOffset(text, end),
      },
      features: [{ $type: "app.bsky.richtext.facet#tag", tag }],
    })
  }

  return facets
}

const segmenter =
  typeof Intl !== "undefined" && Intl.Segmenter
    ? new Intl.Segmenter(undefined, { granularity: "grapheme" })
    : null

export function graphemeLength(text: string): number {
  if (segmenter) {
    return [...segmenter.segment(text)].length
  }
  return [...text].length
}
