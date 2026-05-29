# Bluesky & Mastodon Provider Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Bluesky (App Password auth) and Mastodon (dynamic OAuth per-instance) as social platforms, with image support, compose previews, and publishing settings.

**Architecture:** Both providers implement the existing `SocialProviderAdapter` interface. Bluesky uses AT Protocol with App Password auth (no OAuth redirect — inline modal). Mastodon uses standard OAuth 2.0 with dynamic client registration per instance, stored in a new `social_mastodon_instances` table. Facet parsing (links, mentions, hashtags) is built for Bluesky at publish time. Mastodon exposes visibility and content warning as Publishing Settings.

**Tech Stack:** `@atproto/api` for Bluesky, raw fetch for Mastodon REST API, Drizzle ORM for schema, Vitest for tests, React + shadcn/ui for compose UI.

---

## File Map

### New files

| File | Responsibility |
|------|---------------|
| `src/lib/social/providers/bluesky.ts` | Bluesky provider adapter (auth, publish, facets, image upload) |
| `src/lib/social/providers/mastodon.ts` | Mastodon provider adapter (dynamic OAuth, publish, image upload) |
| `src/lib/social/providers/__tests__/bluesky.test.ts` | Bluesky provider unit tests |
| `src/lib/social/providers/__tests__/mastodon.test.ts` | Mastodon provider unit tests |
| `src/lib/social/bluesky-facets.ts` | Facet parser for Bluesky (links, mentions, hashtags → byte-range annotations) |
| `src/lib/social/__tests__/bluesky-facets.test.ts` | Facet parser unit tests |
| `src/components/social/compose/BlueskyPreview.tsx` | Bluesky post preview component |
| `src/components/social/compose/MastodonPreview.tsx` | Mastodon post preview component |
| `src/components/social/BlueskyConnectModal.tsx` | Inline modal for Bluesky App Password auth |
| `src/components/social/MastodonConnectModal.tsx` | Two-step modal for Mastodon instance + OAuth |
| `src/app/api/social/accounts/connect-bluesky/route.ts` | API route for Bluesky App Password auth (no OAuth redirect) |
| `src/app/api/social/accounts/connect-mastodon/route.ts` | API route for Mastodon dynamic instance registration + OAuth initiation |

### Modified files

| File | Change |
|------|--------|
| `src/lib/db/schema.ts` | Add `"bluesky"`, `"mastodon"` to `socialPlatformEnum`; add `socialMastodonInstances` table |
| `src/lib/social/providers/index.ts` | Import and re-export bluesky + mastodon providers |
| `src/lib/social/constants.ts` | Add entries to `PLATFORM_COLORS`, `PLATFORM_LABELS`, `PLATFORM_ICONS` |
| `src/lib/social/publishing-settings.ts` | Add mastodon definition (visibility, contentWarning) |
| `src/lib/social/__tests__/publishing-settings.test.ts` | Add mastodon publishing settings tests |
| `src/lib/social/providers/__tests__/conformance.test.ts` | Add bluesky + mastodon to conformance suite |
| `src/components/social/compose/PreviewPanel.tsx` | Add BlueskyPreview + MastodonPreview to `PREVIEW_COMPONENTS` |
| `src/components/social/compose/PublishingSettingsPanels.tsx` | Add Mastodon settings fields (visibility, content warning) |
| `src/components/social/PlatformPicker.tsx` | Handle bluesky (open BlueskyConnectModal) and mastodon (open MastodonConnectModal) instead of OAuth redirect |

---

## Task 1: Database Schema — Add Platforms and Mastodon Instances Table

**Files:**
- Modify: `src/lib/db/schema.ts`

- [ ] **Step 1: Add `bluesky` and `mastodon` to the platform enum**

In `src/lib/db/schema.ts`, find the `socialPlatformEnum` and add the two new platforms:

```typescript
export const socialPlatformEnum = pgEnum("social_platform", [
  "x", "linkedin", "instagram", "tiktok", "threads", "pinterest", "facebook", "youtube", "reddit",
  "bluesky", "mastodon",
])
```

- [ ] **Step 2: Add the `socialMastodonInstances` table**

Add below the existing `socialOAuthSelectionSessions` table in `src/lib/db/schema.ts`:

```typescript
export const socialMastodonInstances = pgTable(
  "social_mastodon_instances",
  {
    id: text("id").primaryKey(),
    instanceUrl: text("instance_url").notNull(),
    clientId: text("client_id").notNull(),
    clientSecret: text("client_secret").notNull(),
    maxCharacters: integer("max_characters").notNull().default(500),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    instanceUrlUnique: uniqueIndex("social_mastodon_instances_url_unique").on(table.instanceUrl),
  }),
)
```

- [ ] **Step 3: Generate the Drizzle migration**

Run: `pnpm db:generate`

Expected: A new migration SQL file in `drizzle/` that adds `bluesky` and `mastodon` to the enum and creates the `social_mastodon_instances` table.

- [ ] **Step 4: Run the migration locally**

Run: `pnpm db:migrate`

Expected: Migration applies without errors.

- [ ] **Step 5: Commit**

```bash
git add src/lib/db/schema.ts drizzle/
git commit -m "feat(social): add bluesky and mastodon platform enum values and mastodon instances table"
```

---

## Task 2: Constants — Platform Colors, Labels, Icons

**Files:**
- Modify: `src/lib/social/constants.ts`

- [ ] **Step 1: Add Bluesky and Mastodon to all three maps**

In `src/lib/social/constants.ts`, add entries to `PLATFORM_COLORS`, `PLATFORM_LABELS`, and `PLATFORM_ICONS`:

```typescript
// In PLATFORM_COLORS:
bluesky: "#0085FF",
mastodon: "#6364FF",

// In PLATFORM_LABELS:
bluesky: "Bluesky",
mastodon: "Mastodon",

// In PLATFORM_ICONS (Bluesky butterfly):
bluesky: "M12 10.8c-1.087-2.114-4.046-6.053-6.798-7.995C2.566.944 1.561 1.266.902 1.565.139 1.908 0 3.08 0 3.768c0 .69.378 5.65.614 6.46.824 2.828 3.781 3.554 6.46 3.24-4.674.49-8.782 2.028-3.593 7.143 5.623 4.96 7.482-1.263 8.519-3.981.17-.449.25-.658.25-.658s.08.21.25.658c1.037 2.718 2.896 8.94 8.519 3.981 5.19-5.115 1.081-6.654-3.593-7.143 2.679.314 5.636-.412 6.46-3.24C24.022 9.418 24.4 4.457 24.4 3.768c0-.69-.139-1.861-.902-2.203-.66-.299-1.664-.621-4.3 1.24C16.446 4.748 13.087 8.687 12 10.8z",

// In PLATFORM_ICONS (Mastodon):
mastodon: "M23.268 5.313c-.35-2.578-2.617-4.61-5.304-5.004C17.51.242 15.792 0 11.813 0h-.03c-3.98 0-4.835.242-5.288.309C3.882.692 1.496 2.518.917 5.127.64 6.412.61 7.837.661 9.143c.074 1.874.088 3.745.26 5.611.118 1.24.325 2.47.62 3.68.55 2.237 2.777 4.098 4.96 4.857 2.336.792 4.849.923 7.256.38.265-.061.527-.132.786-.213.585-.186 1.27-.396 1.77-.85a.075.075 0 00.027-.06v-1.755a.072.072 0 00-.093-.069 19.26 19.26 0 01-4.464.525c-2.587 0-3.284-1.216-3.484-1.721a4.706 4.706 0 01-.262-1.259.072.072 0 01.058-.076 18.654 18.654 0 004.397-.525 4.64 4.64 0 003.182-3.097c.329-1.204.306-2.46.241-3.465-.012-.177-.024-.337-.033-.478-.046-.728-.08-1.442.015-2.123.074-.528.298-1.075.705-1.486A1.816 1.816 0 0118.5 7.5a.793.793 0 01.112.47c-.085.695-.05 1.382-.01 2.017l.02.294c.032.448.052.886-.01 1.285a2.82 2.82 0 01-2.035 2.354 7.81 7.81 0 01-1.938.441v3.042a.072.072 0 00.088.07c1.558-.372 2.927-1.174 3.94-2.318 1.28-1.442 1.907-3.393 1.907-5.96V7.634c.003-.45-.013-.88-.04-1.29l-.006-.065c-.01-.117-.021-.234-.03-.354-.014-.173-.025-.346-.033-.52-.015-.312-.017-.63.003-.95.028-.427.1-.85.217-1.26.08-.281-.065-.576-.345-.565-1.066.043-2.125.357-3.02.87a.836.836 0 01-.37.091 20.464 20.464 0 00-5.266-.678c-1.858 0-3.634.24-5.266.678a.836.836 0 01-.37-.091A6.16 6.16 0 003.02 2.63c-.28-.011-.425.284-.345.565.117.41.19.833.217 1.26z",
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `pnpm tsc --noEmit 2>&1 | head -20`

Expected: No errors related to missing platform keys (TypeScript will catch missing `Record<SocialPlatform, ...>` entries).

- [ ] **Step 3: Commit**

```bash
git add src/lib/social/constants.ts
git commit -m "feat(social): add bluesky and mastodon platform constants"
```

---

## Task 3: Bluesky Facet Parser

**Files:**
- Create: `src/lib/social/bluesky-facets.ts`
- Create: `src/lib/social/__tests__/bluesky-facets.test.ts`

- [ ] **Step 1: Write the failing tests for facet detection**

Create `src/lib/social/__tests__/bluesky-facets.test.ts`:

```typescript
import { describe, expect, it, vi } from "vitest"
import { detectFacets } from "@/lib/social/bluesky-facets"

const mockResolveHandle = vi.fn()

describe("detectFacets", () => {
  it("detects a URL and returns a link facet", async () => {
    const text = "Check out https://example.com for more"
    const facets = await detectFacets(text, mockResolveHandle)

    expect(facets).toHaveLength(1)
    expect(facets[0].features[0].$type).toBe("app.bsky.richtext.facet#link")
    expect(facets[0].features[0].uri).toBe("https://example.com")

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
    expect(facets[0].features[0].did).toBe("did:plc:abc123")
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
    expect(facets[0].features[0].tag).toBe("photography")
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
    expect(facets[0].features[0].tag).toBe("photography")
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run src/lib/social/__tests__/bluesky-facets.test.ts`

Expected: FAIL — `detectFacets` does not exist yet.

- [ ] **Step 3: Implement the facet parser**

Create `src/lib/social/bluesky-facets.ts`:

```typescript
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

const segmenter = typeof Intl !== "undefined" && Intl.Segmenter
  ? new Intl.Segmenter(undefined, { granularity: "grapheme" })
  : null

export function graphemeLength(text: string): number {
  if (segmenter) {
    return [...segmenter.segment(text)].length
  }
  return [...text].length
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run src/lib/social/__tests__/bluesky-facets.test.ts`

Expected: All 7 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/social/bluesky-facets.ts src/lib/social/__tests__/bluesky-facets.test.ts
git commit -m "feat(social): add bluesky facet parser for links, mentions, and hashtags"
```

---

## Task 4: Bluesky Provider Adapter

**Files:**
- Create: `src/lib/social/providers/bluesky.ts`
- Create: `src/lib/social/providers/__tests__/bluesky.test.ts`

- [ ] **Step 1: Install the AT Protocol package**

Run: `pnpm add @atproto/api`

- [ ] **Step 2: Write the failing tests**

Create `src/lib/social/providers/__tests__/bluesky.test.ts`:

```typescript
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { clearRegistry } from "@/lib/social/provider-registry"

const mockAgent = {
  login: vi.fn(),
  resumeSession: vi.fn(),
  session: { did: "did:plc:test123", handle: "alice.bsky.social" },
  getProfile: vi.fn(),
  uploadBlob: vi.fn(),
  post: vi.fn(),
  com: { atproto: { identity: { resolveHandle: vi.fn() } } },
}

vi.mock("@atproto/api", () => ({
  AtpAgent: vi.fn(() => mockAgent),
}))

const mockFetch = vi.fn()
vi.stubGlobal("fetch", mockFetch)

function mockFetchOk(body: ArrayBuffer | string) {
  const buffer = typeof body === "string" ? new TextEncoder().encode(body).buffer : body
  return {
    ok: true,
    status: 200,
    arrayBuffer: vi.fn().mockResolvedValue(buffer),
    headers: new Headers({ "content-type": "image/jpeg" }),
  }
}

import { blueskyProvider } from "@/lib/social/providers/bluesky"

describe("blueskyProvider", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    clearRegistry()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe("capabilities", () => {
    it("exposes correct metadata", () => {
      expect(blueskyProvider.identifier).toBe("bluesky")
      expect(blueskyProvider.maxContentLength).toBe(300)
      expect(blueskyProvider.supportsImages).toBe(true)
      expect(blueskyProvider.supportsVideo).toBe(false)
      expect(blueskyProvider.maxImages).toBe(4)
      expect(blueskyProvider.requiresPageSelection).toBe(false)
    })
  })

  describe("authenticate", () => {
    it("creates session with app password and returns profile", async () => {
      mockAgent.login.mockResolvedValueOnce({
        data: {
          did: "did:plc:test123",
          handle: "alice.bsky.social",
          accessJwt: "access-jwt",
          refreshJwt: "refresh-jwt",
        },
      })
      mockAgent.getProfile.mockResolvedValueOnce({
        data: {
          did: "did:plc:test123",
          handle: "alice.bsky.social",
          displayName: "Alice",
          avatar: "https://cdn.bsky.app/avatar.jpg",
        },
      })

      const result = await blueskyProvider.authenticate({
        code: "app-password-here",
        state: "alice.bsky.social",
        redirectUri: "",
      })

      expect(result.platformUserId).toBe("did:plc:test123")
      expect(result.displayName).toBe("Alice")
      expect(result.username).toBe("alice.bsky.social")
      expect(result.accessToken).toBe("access-jwt")
      expect(result.refreshToken).toBe("refresh-jwt")
      expect(result.requiresPageSelection).toBe(false)
      expect(mockAgent.login).toHaveBeenCalledWith({
        identifier: "alice.bsky.social",
        password: "app-password-here",
      })
    })
  })

  describe("refreshToken", () => {
    it("resumes session with refresh JWT", async () => {
      mockAgent.resumeSession.mockResolvedValueOnce(undefined)
      Object.defineProperty(mockAgent, "session", {
        value: {
          did: "did:plc:test123",
          handle: "alice.bsky.social",
          accessJwt: "new-access-jwt",
          refreshJwt: "new-refresh-jwt",
        },
        writable: true,
        configurable: true,
      })

      const result = await blueskyProvider.refreshToken(
        JSON.stringify({
          refreshJwt: "old-refresh-jwt",
          did: "did:plc:test123",
          handle: "alice.bsky.social",
        }),
      )

      expect(result.accessToken).toBe("new-access-jwt")
    })
  })

  describe("post", () => {
    it("creates a text post", async () => {
      mockAgent.post.mockResolvedValueOnce({
        uri: "at://did:plc:test123/app.bsky.feed.post/abc123",
        cid: "bafyreiabc123",
      })

      const results = await blueskyProvider.post(
        "did:plc:test123",
        "access-jwt",
        [{
          postId: "spost_1",
          content: "Hello from node banana",
        }],
      )

      expect(results).toHaveLength(1)
      expect(results[0].status).toBe("published")
      expect(results[0].platformPostUrl).toContain("bsky.app")
    })

    it("creates a post with images", async () => {
      mockFetch.mockResolvedValueOnce(mockFetchOk(new ArrayBuffer(100)))
      mockAgent.uploadBlob.mockResolvedValueOnce({
        data: { blob: { ref: { $link: "blob-ref" }, mimeType: "image/jpeg", size: 100 } },
      })
      mockAgent.post.mockResolvedValueOnce({
        uri: "at://did:plc:test123/app.bsky.feed.post/abc123",
        cid: "bafyreiabc123",
      })

      const results = await blueskyProvider.post(
        "did:plc:test123",
        "access-jwt",
        [{
          postId: "spost_1",
          content: "Post with image",
          media: [{ type: "image", url: "https://example.com/photo.jpg", alt: "A photo" }],
        }],
      )

      expect(results).toHaveLength(1)
      expect(mockAgent.uploadBlob).toHaveBeenCalled()
    })
  })

  describe("classifyError", () => {
    it("classifies auth errors as refresh-token", () => {
      const result = blueskyProvider.classifyError(new Error("ExpiredToken"))
      expect(result.type).toBe("refresh-token")
    })

    it("classifies invalid record as bad-body", () => {
      const result = blueskyProvider.classifyError(new Error("InvalidRequest: record is invalid"))
      expect(result.type).toBe("bad-body")
    })

    it("classifies rate limit as retry", () => {
      const result = blueskyProvider.classifyError(new Error("RateLimitExceeded"))
      expect(result.type).toBe("retry")
    })
  })
})
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `pnpm vitest run src/lib/social/providers/__tests__/bluesky.test.ts`

Expected: FAIL — `blueskyProvider` does not exist.

- [ ] **Step 4: Implement the Bluesky provider**

Create `src/lib/social/providers/bluesky.ts`:

```typescript
import { AtpAgent } from "@atproto/api"
import type {
  AuthenticateParams,
  AuthenticateResult,
  GenerateAuthUrlResult,
  ProviderCapabilities,
  PublishMediaItem,
  PublishRequest,
  PublishResult,
  RefreshTokenResult,
  SocialProviderAdapter,
  SocialProviderError,
} from "@/lib/social/provider-interface"
import { registerProvider } from "@/lib/social/provider-registry"
import { detectFacets, graphemeLength } from "@/lib/social/bluesky-facets"

const BLUESKY_SERVICE = "https://bsky.social"
const MAX_IMAGE_SIZE = 1_000_000 // 1MB

export const blueskyProvider: SocialProviderAdapter = {
  identifier: "bluesky",
  displayName: "Bluesky",
  maxContentLength: 300,
  supportsImages: true,
  supportsVideo: false,
  supportsCarousel: false,
  maxImages: 4,
  maxConcurrentJobs: 5,
  requiresPageSelection: false,

  async generateAuthUrl(_callbackUrl: string): Promise<GenerateAuthUrlResult> {
    throw new Error("Bluesky uses App Password auth, not OAuth redirect.")
  },

  async authenticate(params: AuthenticateParams): Promise<AuthenticateResult> {
    const handle = params.state.replace(/^@/, "")
    const appPassword = params.code

    const agent = new AtpAgent({ service: BLUESKY_SERVICE })
    const { data: session } = await agent.login({
      identifier: handle,
      password: appPassword,
    })

    const { data: profile } = await agent.getProfile({ actor: session.did })

    return {
      platformUserId: session.did,
      accessToken: session.accessJwt,
      refreshToken: JSON.stringify({
        refreshJwt: session.refreshJwt,
        did: session.did,
        handle: session.handle,
      }),
      displayName: profile.displayName || session.handle,
      username: session.handle,
      avatarUrl: profile.avatar,
      requiresPageSelection: false,
    }
  },

  async refreshToken(refreshToken: string): Promise<RefreshTokenResult> {
    const { refreshJwt, did, handle } = JSON.parse(refreshToken) as {
      refreshJwt: string
      did: string
      handle: string
    }

    const agent = new AtpAgent({ service: BLUESKY_SERVICE })
    await agent.resumeSession({
      did,
      handle,
      accessJwt: "",
      refreshJwt,
      active: true,
    })

    if (!agent.session) {
      throw new Error("Bluesky session refresh failed: no session returned")
    }

    return {
      accessToken: agent.session.accessJwt,
      refreshToken: JSON.stringify({
        refreshJwt: agent.session.refreshJwt,
        did: agent.session.did,
        handle: agent.session.handle,
      }),
    }
  },

  async post(
    platformUserId: string,
    accessToken: string,
    requests: PublishRequest[],
  ): Promise<PublishResult[]> {
    const results: PublishResult[] = []

    for (const request of requests) {
      if (graphemeLength(request.content) > 300) {
        throw new Error("Bluesky post exceeds 300 grapheme character limit.")
      }

      const agent = new AtpAgent({ service: BLUESKY_SERVICE })
      await agent.resumeSession({
        did: platformUserId,
        handle: "",
        accessJwt: accessToken,
        refreshJwt: "",
        active: true,
      })

      const resolveHandle = async (h: string) => {
        const res = await agent.com.atproto.identity.resolveHandle({ handle: h })
        return res.data.did
      }

      const facets = await detectFacets(request.content, resolveHandle)

      const images = await uploadImages(agent, request.media ?? [])

      const record: Record<string, unknown> = {
        text: request.content,
        createdAt: new Date().toISOString(),
      }
      if (facets.length > 0) {
        record.facets = facets
      }
      if (images.length > 0) {
        record.embed = {
          $type: "app.bsky.embed.images",
          images,
        }
      }

      const response = await agent.post(record)

      const rkey = response.uri.split("/").pop()
      const postUrl = `https://bsky.app/profile/${platformUserId}/post/${rkey}`

      results.push({
        postId: request.postId,
        platformPostId: response.uri,
        platformPostUrl: postUrl,
        status: "published",
      })
    }

    return results
  },

  classifyError(error: unknown): SocialProviderError {
    const message = error instanceof Error ? error.message : String(error)
    const lower = message.toLowerCase()

    if (
      lower.includes("expiredtoken") ||
      lower.includes("invalid token") ||
      lower.includes("authentication required") ||
      lower.includes("session expired")
    ) {
      return {
        type: "refresh-token",
        message: "Bluesky session expired. Will attempt refresh.",
        original: error,
      }
    }

    if (
      lower.includes("invalidrequest") ||
      lower.includes("record is invalid") ||
      lower.includes("invalid app password") ||
      lower.includes("could not find repo")
    ) {
      return {
        type: "bad-body",
        message,
        original: error,
      }
    }

    if (
      lower.includes("ratelimit") ||
      lower.includes("rate limit") ||
      lower.includes("upstream") ||
      lower.includes("timeout") ||
      lower.includes("503") ||
      lower.includes("502")
    ) {
      return {
        type: "retry",
        message: "Bluesky is temporarily unavailable. Will retry.",
        original: error,
      }
    }

    return { type: "retry", message, original: error }
  },

  getCapabilities(): ProviderCapabilities {
    return {
      identifier: "bluesky",
      displayName: "Bluesky",
      maxContentLength: 300,
      supportsImages: true,
      supportsVideo: false,
      supportsCarousel: false,
      requiresPageSelection: false,
    }
  },
}

async function uploadImages(
  agent: AtpAgent,
  media: PublishMediaItem[],
): Promise<Array<{ alt: string; image: unknown }>> {
  const images: Array<{ alt: string; image: unknown }> = []

  for (const item of media) {
    if (item.type !== "image") continue
    if (images.length >= 4) break

    const response = await fetch(item.url)
    if (!response.ok) {
      throw new Error(`Failed to download image: ${response.status}`)
    }

    const buffer = await response.arrayBuffer()
    if (buffer.byteLength > MAX_IMAGE_SIZE) {
      throw new Error(
        `Image exceeds Bluesky's 1MB limit (${Math.round(buffer.byteLength / 1024)}KB).`,
      )
    }

    const mimeType =
      item.mimeType ||
      response.headers.get("content-type") ||
      "image/jpeg"

    const { data } = await agent.uploadBlob(new Uint8Array(buffer), {
      encoding: mimeType,
    })

    images.push({
      alt: item.alt || "",
      image: data.blob,
    })
  }

  return images
}

registerProvider(blueskyProvider)
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm vitest run src/lib/social/providers/__tests__/bluesky.test.ts`

Expected: All tests PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/social/providers/bluesky.ts src/lib/social/providers/__tests__/bluesky.test.ts package.json pnpm-lock.yaml
git commit -m "feat(social): add bluesky provider adapter with app password auth and image upload"
```

---

## Task 5: Mastodon Provider Adapter

**Files:**
- Create: `src/lib/social/providers/mastodon.ts`
- Create: `src/lib/social/providers/__tests__/mastodon.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/lib/social/providers/__tests__/mastodon.test.ts`:

```typescript
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { clearRegistry } from "@/lib/social/provider-registry"

const mockFetch = vi.fn()
vi.stubGlobal("fetch", mockFetch)

function mockFetchOk(body: unknown) {
  return {
    ok: true,
    status: 200,
    json: vi.fn().mockResolvedValue(body),
    text: vi.fn().mockResolvedValue(JSON.stringify(body)),
  }
}

function mockFetchError(status: number, body = "error") {
  return {
    ok: false,
    status,
    json: vi.fn().mockResolvedValue({}),
    text: vi.fn().mockResolvedValue(body),
  }
}

import { mastodonProvider } from "@/lib/social/providers/mastodon"

describe("mastodonProvider", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    clearRegistry()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe("capabilities", () => {
    it("exposes correct metadata", () => {
      expect(mastodonProvider.identifier).toBe("mastodon")
      expect(mastodonProvider.maxContentLength).toBe(500)
      expect(mastodonProvider.supportsImages).toBe(true)
      expect(mastodonProvider.supportsVideo).toBe(false)
      expect(mastodonProvider.maxImages).toBe(4)
      expect(mastodonProvider.requiresPageSelection).toBe(false)
    })
  })

  describe("authenticate", () => {
    it("exchanges code for token and returns profile", async () => {
      mockFetch
        .mockResolvedValueOnce(
          mockFetchOk({
            access_token: "mastodon-access-token",
            token_type: "Bearer",
          }),
        )
        .mockResolvedValueOnce(
          mockFetchOk({
            id: "12345",
            username: "alice",
            display_name: "Alice",
            avatar: "https://mastodon.social/avatars/alice.png",
            acct: "alice",
          }),
        )

      const result = await mastodonProvider.authenticate({
        code: "oauth-code",
        state: "state",
        redirectUri: "https://app.example.com/callback",
        codeVerifier: JSON.stringify({
          instanceUrl: "https://mastodon.social",
          clientId: "client-id",
          clientSecret: "client-secret",
        }),
      })

      expect(result.platformUserId).toBe("12345")
      expect(result.displayName).toBe("Alice")
      expect(result.username).toBe("alice")
      expect(result.accessToken).toContain("mastodon-access-token")
      expect(result.requiresPageSelection).toBe(false)
    })

    it("throws on token exchange failure", async () => {
      mockFetch.mockResolvedValueOnce(mockFetchError(401, "invalid_grant"))

      await expect(
        mastodonProvider.authenticate({
          code: "bad-code",
          state: "state",
          redirectUri: "https://app.example.com/callback",
          codeVerifier: JSON.stringify({
            instanceUrl: "https://mastodon.social",
            clientId: "client-id",
            clientSecret: "client-secret",
          }),
        }),
      ).rejects.toThrow("Mastodon token exchange failed")
    })
  })

  describe("refreshToken", () => {
    it("returns same token since mastodon tokens do not expire", async () => {
      const result = await mastodonProvider.refreshToken(
        JSON.stringify({
          accessToken: "mastodon-access-token",
          instanceUrl: "https://mastodon.social",
        }),
      )

      expect(result.accessToken).toBe("mastodon-access-token")
    })
  })

  describe("post", () => {
    it("creates a text-only status", async () => {
      mockFetch.mockResolvedValueOnce(
        mockFetchOk({
          id: "109876543",
          url: "https://mastodon.social/@alice/109876543",
        }),
      )

      const results = await mastodonProvider.post(
        "12345",
        JSON.stringify({
          accessToken: "mastodon-access-token",
          instanceUrl: "https://mastodon.social",
        }),
        [{
          postId: "spost_1",
          content: "Hello from node banana",
        }],
      )

      expect(results).toHaveLength(1)
      expect(results[0].status).toBe("published")
      expect(results[0].platformPostId).toBe("109876543")
      expect(results[0].platformPostUrl).toContain("mastodon.social")
    })

    it("creates a status with visibility and content warning", async () => {
      mockFetch.mockResolvedValueOnce(
        mockFetchOk({
          id: "109876544",
          url: "https://mastodon.social/@alice/109876544",
        }),
      )

      await mastodonProvider.post(
        "12345",
        JSON.stringify({
          accessToken: "mastodon-access-token",
          instanceUrl: "https://mastodon.social",
        }),
        [{
          postId: "spost_2",
          content: "Spoiler content",
          platformSettings: {
            visibility: "unlisted",
            contentWarning: "TV show spoiler",
          },
        }],
      )

      const body = JSON.parse(mockFetch.mock.calls[0][1].body as string)
      expect(body.visibility).toBe("unlisted")
      expect(body.spoiler_text).toBe("TV show spoiler")
    })

    it("creates a status with image attachments", async () => {
      // Upload media
      mockFetch.mockResolvedValueOnce(
        mockFetchOk(new ArrayBuffer(100)),
      )
      mockFetch.mock.results = []
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(100)),
          headers: new Headers({ "content-type": "image/jpeg" }),
        })
        .mockResolvedValueOnce(
          mockFetchOk({ id: "media-1", type: "image" }),
        )
        .mockResolvedValueOnce(
          mockFetchOk({
            id: "109876545",
            url: "https://mastodon.social/@alice/109876545",
          }),
        )

      const results = await mastodonProvider.post(
        "12345",
        JSON.stringify({
          accessToken: "mastodon-access-token",
          instanceUrl: "https://mastodon.social",
        }),
        [{
          postId: "spost_3",
          content: "Post with image",
          media: [{ type: "image", url: "https://example.com/photo.jpg", alt: "A photo" }],
        }],
      )

      expect(results).toHaveLength(1)
    })
  })

  describe("classifyError", () => {
    it("classifies 401 as refresh-token", () => {
      expect(
        mastodonProvider.classifyError(new Error("401 Unauthorized")).type,
      ).toBe("refresh-token")
    })

    it("classifies validation errors as bad-body", () => {
      expect(
        mastodonProvider.classifyError(new Error("422 Unprocessable: content too long")).type,
      ).toBe("bad-body")
    })

    it("classifies rate limit as retry", () => {
      expect(
        mastodonProvider.classifyError(new Error("429 Rate limit")).type,
      ).toBe("retry")
    })
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run src/lib/social/providers/__tests__/mastodon.test.ts`

Expected: FAIL — `mastodonProvider` does not exist.

- [ ] **Step 3: Implement the Mastodon provider**

Create `src/lib/social/providers/mastodon.ts`:

```typescript
import type {
  AuthenticateParams,
  AuthenticateResult,
  GenerateAuthUrlResult,
  ProviderCapabilities,
  PublishMediaItem,
  PublishRequest,
  PublishResult,
  RefreshTokenResult,
  SocialProviderAdapter,
  SocialProviderError,
} from "@/lib/social/provider-interface"
import { registerProvider } from "@/lib/social/provider-registry"

const MASTODON_SCOPES = "read write:statuses write:media"
const MASTODON_REDIRECT_URIS = "urn:ietf:wg:oauth:2.0:oob"

interface MastodonTokenBundle {
  accessToken: string
  instanceUrl: string
}

interface MastodonOAuthContext {
  instanceUrl: string
  clientId: string
  clientSecret: string
}

function parseTokenBundle(raw: string): MastodonTokenBundle {
  return JSON.parse(raw) as MastodonTokenBundle
}

export const mastodonProvider: SocialProviderAdapter = {
  identifier: "mastodon",
  displayName: "Mastodon",
  maxContentLength: 500,
  supportsImages: true,
  supportsVideo: false,
  supportsCarousel: false,
  maxImages: 4,
  maxConcurrentJobs: 5,
  requiresPageSelection: false,

  async generateAuthUrl(callbackUrl: string): Promise<GenerateAuthUrlResult> {
    throw new Error(
      "Mastodon uses dynamic instance registration. Use connect-mastodon API route instead.",
    )
  },

  async authenticate(params: AuthenticateParams): Promise<AuthenticateResult> {
    const ctx = JSON.parse(params.codeVerifier!) as MastodonOAuthContext
    const { instanceUrl, clientId, clientSecret } = ctx

    const tokenResponse = await fetch(`${instanceUrl}/oauth/token`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        grant_type: "authorization_code",
        code: params.code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: params.redirectUri,
      }),
    })

    if (!tokenResponse.ok) {
      const body = await tokenResponse.text()
      throw new Error(`Mastodon token exchange failed: ${tokenResponse.status} ${body}`)
    }

    const tokens = (await tokenResponse.json()) as { access_token?: string }
    if (!tokens.access_token) {
      throw new Error("Mastodon token exchange returned no access token")
    }

    const meResponse = await fetch(`${instanceUrl}/api/v1/accounts/verify_credentials`, {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    })

    if (!meResponse.ok) {
      throw new Error(`Mastodon verify credentials failed: ${meResponse.status}`)
    }

    const me = (await meResponse.json()) as {
      id: string
      username: string
      display_name: string
      avatar: string
      acct: string
    }

    const tokenBundle: MastodonTokenBundle = {
      accessToken: tokens.access_token,
      instanceUrl,
    }

    return {
      platformUserId: me.id,
      accessToken: JSON.stringify(tokenBundle),
      displayName: me.display_name || me.username,
      username: me.acct,
      avatarUrl: me.avatar,
      requiresPageSelection: false,
    }
  },

  async refreshToken(refreshToken: string): Promise<RefreshTokenResult> {
    const bundle = parseTokenBundle(refreshToken)
    return {
      accessToken: bundle.accessToken,
      refreshToken,
    }
  },

  async post(
    _platformUserId: string,
    accessTokenRaw: string,
    requests: PublishRequest[],
  ): Promise<PublishResult[]> {
    const { accessToken, instanceUrl } = parseTokenBundle(accessTokenRaw)
    const results: PublishResult[] = []

    for (const request of requests) {
      const settings = request.platformSettings ?? {}
      const visibility =
        typeof settings.visibility === "string" &&
        ["public", "unlisted", "private", "direct"].includes(settings.visibility)
          ? settings.visibility
          : "public"
      const contentWarning =
        typeof settings.contentWarning === "string"
          ? settings.contentWarning.trim()
          : ""

      const mediaIds = await uploadImages(instanceUrl, accessToken, request.media ?? [])

      const body: Record<string, unknown> = {
        status: request.content,
        visibility,
      }
      if (contentWarning) {
        body.spoiler_text = contentWarning
      }
      if (mediaIds.length > 0) {
        body.media_ids = mediaIds
      }

      const response = await fetch(`${instanceUrl}/api/v1/statuses`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      })

      if (!response.ok) {
        const text = await response.text()
        throw new Error(`Mastodon post failed: ${response.status} ${text}`)
      }

      const data = (await response.json()) as {
        id: string
        url: string
      }

      results.push({
        postId: request.postId,
        platformPostId: data.id,
        platformPostUrl: data.url,
        status: "published",
      })
    }

    return results
  },

  classifyError(error: unknown): SocialProviderError {
    const message = error instanceof Error ? error.message : String(error)
    const lower = message.toLowerCase()

    if (
      lower.includes("401") ||
      lower.includes("unauthorized") ||
      lower.includes("token") && lower.includes("invalid")
    ) {
      return {
        type: "refresh-token",
        message: "Mastodon authentication expired. Please reconnect your account.",
        original: error,
      }
    }

    if (
      lower.includes("422") ||
      lower.includes("unprocessable") ||
      lower.includes("validation") ||
      lower.includes("too long") ||
      lower.includes("400") ||
      lower.includes("bad request")
    ) {
      return {
        type: "bad-body",
        message,
        original: error,
      }
    }

    if (
      lower.includes("429") ||
      lower.includes("rate limit") ||
      lower.includes("503") ||
      lower.includes("timeout") ||
      lower.includes("temporarily unavailable")
    ) {
      return {
        type: "retry",
        message: "Mastodon instance is temporarily unavailable. Will retry.",
        original: error,
      }
    }

    return { type: "retry", message, original: error }
  },

  getCapabilities(): ProviderCapabilities {
    return {
      identifier: "mastodon",
      displayName: "Mastodon",
      maxContentLength: 500,
      supportsImages: true,
      supportsVideo: false,
      supportsCarousel: false,
      requiresPageSelection: false,
    }
  },
}

async function uploadImages(
  instanceUrl: string,
  accessToken: string,
  media: PublishMediaItem[],
): Promise<string[]> {
  const ids: string[] = []

  for (const item of media) {
    if (item.type !== "image") continue
    if (ids.length >= 4) break

    const imageResponse = await fetch(item.url)
    if (!imageResponse.ok) {
      throw new Error(`Failed to download image: ${imageResponse.status}`)
    }

    const buffer = await imageResponse.arrayBuffer()
    const mimeType =
      item.mimeType ||
      imageResponse.headers.get("content-type") ||
      "image/jpeg"

    const formData = new FormData()
    formData.append("file", new Blob([buffer], { type: mimeType }), "image")
    if (item.alt) {
      formData.append("description", item.alt)
    }

    const uploadResponse = await fetch(`${instanceUrl}/api/v2/media`, {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}` },
      body: formData,
    })

    if (!uploadResponse.ok) {
      const text = await uploadResponse.text()
      throw new Error(`Mastodon media upload failed: ${uploadResponse.status} ${text}`)
    }

    const data = (await uploadResponse.json()) as { id: string }
    ids.push(data.id)
  }

  return ids
}

registerProvider(mastodonProvider)
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run src/lib/social/providers/__tests__/mastodon.test.ts`

Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/social/providers/mastodon.ts src/lib/social/providers/__tests__/mastodon.test.ts
git commit -m "feat(social): add mastodon provider adapter with dynamic instance oauth and image upload"
```

---

## Task 6: Register Providers and Update Conformance Tests

**Files:**
- Modify: `src/lib/social/providers/index.ts`
- Modify: `src/lib/social/providers/__tests__/conformance.test.ts`

- [ ] **Step 1: Add imports to the provider barrel file**

In `src/lib/social/providers/index.ts`, add:

```typescript
import "./bluesky"
import "./mastodon"

// ... existing exports ...
export { blueskyProvider } from "./bluesky"
export { mastodonProvider } from "./mastodon"
```

- [ ] **Step 2: Add to conformance test**

In `src/lib/social/providers/__tests__/conformance.test.ts`, add the imports:

```typescript
import {
  // ... existing imports ...
  blueskyProvider,
  mastodonProvider,
} from "@/lib/social/providers";
```

Add to the `providers` array:

```typescript
const providers = [
  // ... existing ...
  blueskyProvider,
  mastodonProvider,
] as const;
```

Add to `classificationFixtures`:

```typescript
bluesky: {
  token: "ExpiredToken session expired",
  badBody: "InvalidRequest: record is invalid",
  retry: "RateLimitExceeded",
},
mastodon: {
  token: "401 Unauthorized token invalid",
  badBody: "422 Unprocessable validation too long",
  retry: "429 Rate limit exceeded",
},
```

- [ ] **Step 3: Run the full conformance suite**

Run: `pnpm vitest run src/lib/social/providers/__tests__/conformance.test.ts`

Expected: All 11 providers (9 existing + 2 new) pass both conformance tests.

- [ ] **Step 4: Commit**

```bash
git add src/lib/social/providers/index.ts src/lib/social/providers/__tests__/conformance.test.ts
git commit -m "feat(social): register bluesky and mastodon in provider index and conformance tests"
```

---

## Task 7: Mastodon Publishing Settings

**Files:**
- Modify: `src/lib/social/publishing-settings.ts`
- Modify: `src/lib/social/__tests__/publishing-settings.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `src/lib/social/__tests__/publishing-settings.test.ts`:

```typescript
describe("mastodon publishing settings", () => {
  it("defaults to public visibility with no content warning", () => {
    const definition = getPublishingSettingsDefinition("mastodon")
    expect(definition.defaults).toEqual({
      visibility: "public",
      contentWarning: "",
    })
  })

  it("normalizes valid visibility values", () => {
    const definition = getPublishingSettingsDefinition("mastodon")
    const result = definition.normalize({ visibility: "unlisted", contentWarning: "spoiler" })
    expect(result.visibility).toBe("unlisted")
    expect(result.contentWarning).toBe("spoiler")
  })

  it("falls back to public for invalid visibility", () => {
    const definition = getPublishingSettingsDefinition("mastodon")
    const result = definition.normalize({ visibility: "invalid" })
    expect(result.visibility).toBe("public")
  })

  it("trims content warning whitespace", () => {
    const definition = getPublishingSettingsDefinition("mastodon")
    const result = definition.normalize({ contentWarning: "  spoiler  " })
    expect(result.contentWarning).toBe("spoiler")
  })

  it("validates successfully with defaults", () => {
    const definition = getPublishingSettingsDefinition("mastodon")
    const result = definition.validateForPublish(definition.defaults, {
      content: "Hello",
      media: [],
    })
    expect(result.valid).toBe(true)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run src/lib/social/__tests__/publishing-settings.test.ts`

Expected: FAIL — mastodon definition not found.

- [ ] **Step 3: Add the mastodon definition**

In `src/lib/social/publishing-settings.ts`, add before the `definitions` map:

```typescript
const mastodonVisibilities = new Set(["public", "unlisted", "private", "direct"])

const mastodonDefinition: PublishingSettingsDefinition = {
  platform: "mastodon",
  label: "Mastodon",
  defaults: {
    visibility: "public",
    contentWarning: "",
  },
  normalize(settings) {
    return {
      visibility:
        typeof settings?.visibility === "string" &&
        mastodonVisibilities.has(settings.visibility)
          ? settings.visibility
          : "public",
      contentWarning:
        typeof settings?.contentWarning === "string"
          ? settings.contentWarning.trim()
          : "",
    }
  },
  validateForPublish(_settings, _context) {
    return { valid: true, errors: [] }
  },
}
```

Add `["mastodon", mastodonDefinition]` to the `definitions` map.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run src/lib/social/__tests__/publishing-settings.test.ts`

Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/social/publishing-settings.ts src/lib/social/__tests__/publishing-settings.test.ts
git commit -m "feat(social): add mastodon publishing settings definition with visibility and content warning"
```

---

## Task 8: Bluesky Connect API Route

**Files:**
- Create: `src/app/api/social/accounts/connect-bluesky/route.ts`

- [ ] **Step 1: Create the API route**

Create `src/app/api/social/accounts/connect-bluesky/route.ts`:

```typescript
import { NextResponse, type NextRequest } from "next/server"
import { withApiPermission } from "@/lib/api/permissions"
import { db } from "@/lib/db"
import { socialAccounts } from "@/lib/db/schema"
import { blueskyProvider } from "@/lib/social/providers/bluesky"
import { encryptToken } from "@/lib/social/crypto"
import { eq, and } from "drizzle-orm"
import { nanoid } from "nanoid"

interface ConnectBlueskyRequest {
  handle: string
  appPassword: string
}

interface ConnectBlueskyResponse {
  success: boolean
  account?: {
    id: string
    platform: string
    displayName: string
    username: string | null
  }
  error?: string
}

export const POST = withApiPermission("social:connect", async (
  request: NextRequest,
  { workspaceId, userId },
): Promise<NextResponse<ConnectBlueskyResponse>> => {
  const body = (await request.json()) as ConnectBlueskyRequest

  if (!body.handle || !body.appPassword) {
    return NextResponse.json(
      { success: false, error: "Handle and app password are required." },
      { status: 400 },
    )
  }

  const handle = body.handle.replace(/^@/, "").trim()

  try {
    const result = await blueskyProvider.authenticate({
      code: body.appPassword,
      state: handle,
      redirectUri: "",
    })

    const accountId = nanoid()
    const now = new Date()

    const existing = await db.query.socialAccounts.findFirst({
      where: and(
        eq(socialAccounts.workspaceId, workspaceId),
        eq(socialAccounts.platform, "bluesky"),
        eq(socialAccounts.platformUserId, result.platformUserId),
      ),
    })

    if (existing) {
      await db
        .update(socialAccounts)
        .set({
          accessTokenEncrypted: encryptToken(result.accessToken),
          refreshTokenEncrypted: result.refreshToken
            ? encryptToken(result.refreshToken)
            : null,
          displayName: result.displayName,
          username: result.username,
          avatarUrl: result.avatarUrl,
          requiresReauth: false,
          updatedAt: now,
        })
        .where(eq(socialAccounts.id, existing.id))

      return NextResponse.json({
        success: true,
        account: {
          id: existing.id,
          platform: "bluesky",
          displayName: result.displayName,
          username: result.username ?? null,
        },
      })
    }

    await db.insert(socialAccounts).values({
      id: accountId,
      workspaceId,
      platform: "bluesky",
      platformUserId: result.platformUserId,
      displayName: result.displayName,
      username: result.username,
      avatarUrl: result.avatarUrl,
      accessTokenEncrypted: encryptToken(result.accessToken),
      refreshTokenEncrypted: result.refreshToken
        ? encryptToken(result.refreshToken)
        : null,
      createdByUserId: userId,
      createdAt: now,
      updatedAt: now,
    })

    return NextResponse.json({
      success: true,
      account: {
        id: accountId,
        platform: "bluesky",
        displayName: result.displayName,
        username: result.username ?? null,
      },
    })
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to connect Bluesky account"
    return NextResponse.json(
      { success: false, error: message },
      { status: 400 },
    )
  }
})
```

- [ ] **Step 2: Commit**

```bash
git add src/app/api/social/accounts/connect-bluesky/route.ts
git commit -m "feat(social): add bluesky app password connect API route"
```

---

## Task 9: Mastodon Connect API Route (Dynamic Instance Registration)

**Files:**
- Create: `src/app/api/social/accounts/connect-mastodon/route.ts`

- [ ] **Step 1: Create the API route**

Create `src/app/api/social/accounts/connect-mastodon/route.ts`:

```typescript
import { NextResponse, type NextRequest } from "next/server"
import { withApiPermission } from "@/lib/api/permissions"
import { db } from "@/lib/db"
import { socialMastodonInstances, socialOAuthStates } from "@/lib/db/schema"
import { eq } from "drizzle-orm"
import { nanoid } from "nanoid"
import { randomBytes } from "crypto"

interface ConnectMastodonRequest {
  instanceUrl: string
}

interface ConnectMastodonResponse {
  success: boolean
  authUrl?: string
  error?: string
}

function normalizeInstanceUrl(raw: string): string {
  let url = raw.trim().toLowerCase()
  if (!url.startsWith("http")) {
    url = `https://${url}`
  }
  return url.replace(/\/+$/, "")
}

export const POST = withApiPermission("social:connect", async (
  request: NextRequest,
  { workspaceId, userId },
): Promise<NextResponse<ConnectMastodonResponse>> => {
  const body = (await request.json()) as ConnectMastodonRequest

  if (!body.instanceUrl) {
    return NextResponse.json(
      { success: false, error: "Instance URL is required." },
      { status: 400 },
    )
  }

  const instanceUrl = normalizeInstanceUrl(body.instanceUrl)

  try {
    let instance = await db.query.socialMastodonInstances.findFirst({
      where: eq(socialMastodonInstances.instanceUrl, instanceUrl),
    })

    if (!instance) {
      const appResponse = await fetch(`${instanceUrl}/api/v1/apps`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          client_name: "Node Banana",
          redirect_uris: `${process.env.NEXT_PUBLIC_APP_URL}/social/channels`,
          scopes: "read write:statuses write:media",
          website: process.env.NEXT_PUBLIC_APP_URL || "",
        }),
      })

      if (!appResponse.ok) {
        const text = await appResponse.text()
        throw new Error(`Failed to register app on ${instanceUrl}: ${appResponse.status} ${text}`)
      }

      const app = (await appResponse.json()) as {
        client_id: string
        client_secret: string
      }

      let maxCharacters = 500
      try {
        const instanceInfo = await fetch(`${instanceUrl}/api/v2/instance`)
        if (instanceInfo.ok) {
          const info = (await instanceInfo.json()) as {
            configuration?: { statuses?: { max_characters?: number } }
          }
          maxCharacters = info.configuration?.statuses?.max_characters ?? 500
        }
      } catch {
        // default to 500
      }

      const instanceId = nanoid()
      const now = new Date()
      await db.insert(socialMastodonInstances).values({
        id: instanceId,
        instanceUrl,
        clientId: app.client_id,
        clientSecret: app.client_secret,
        maxCharacters,
        createdAt: now,
        updatedAt: now,
      })

      instance = {
        id: instanceId,
        instanceUrl,
        clientId: app.client_id,
        clientSecret: app.client_secret,
        maxCharacters,
        createdAt: now,
        updatedAt: now,
      }
    }

    const state = randomBytes(16).toString("hex")
    const callbackUrl = `${process.env.NEXT_PUBLIC_APP_URL}/api/social/accounts/callback`

    await db.insert(socialOAuthStates).values({
      id: nanoid(),
      workspaceId,
      platform: "mastodon",
      state,
      codeVerifier: JSON.stringify({
        instanceUrl,
        clientId: instance.clientId,
        clientSecret: instance.clientSecret,
      }),
      metadata: { createdByUserId: userId },
      expiresAt: new Date(Date.now() + 10 * 60 * 1000),
    })

    const authParams = new URLSearchParams({
      client_id: instance.clientId,
      response_type: "code",
      redirect_uri: callbackUrl,
      scope: "read write:statuses write:media",
      state,
    })

    return NextResponse.json({
      success: true,
      authUrl: `${instanceUrl}/oauth/authorize?${authParams.toString()}`,
    })
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to connect Mastodon instance"
    return NextResponse.json(
      { success: false, error: message },
      { status: 400 },
    )
  }
})
```

- [ ] **Step 2: Commit**

```bash
git add src/app/api/social/accounts/connect-mastodon/route.ts
git commit -m "feat(social): add mastodon dynamic instance registration and oauth connect route"
```

---

## Task 10: Bluesky Connect Modal UI

**Files:**
- Create: `src/components/social/BlueskyConnectModal.tsx`

- [ ] **Step 1: Create the modal component**

Create `src/components/social/BlueskyConnectModal.tsx`:

```tsx
"use client"

import { useState } from "react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { useToast } from "@/components/Toast"
import { useSocialAccountsStore } from "@/store/socialAccountsStore"

interface BlueskyConnectModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function BlueskyConnectModal({ open, onOpenChange }: BlueskyConnectModalProps) {
  const [handle, setHandle] = useState("")
  const [appPassword, setAppPassword] = useState("")
  const [isConnecting, setIsConnecting] = useState(false)
  const { show: showToast } = useToast()
  const { fetchAccounts } = useSocialAccountsStore()

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()

    if (!handle.trim() || !appPassword.trim()) {
      showToast("Handle and app password are required.", "error")
      return
    }

    setIsConnecting(true)
    try {
      const response = await fetch("/api/social/accounts/connect-bluesky", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ handle: handle.trim(), appPassword: appPassword.trim() }),
      })

      const data = await response.json()

      if (!response.ok || !data.success) {
        throw new Error(data.error || "Failed to connect Bluesky account")
      }

      showToast("Bluesky channel connected!", "success")
      fetchAccounts()
      onOpenChange(false)
      setHandle("")
      setAppPassword("")
    } catch (error) {
      showToast(
        error instanceof Error ? error.message : "Failed to connect",
        "error",
      )
    } finally {
      setIsConnecting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Connect Bluesky</DialogTitle>
          <DialogDescription>
            Enter your Bluesky handle and an{" "}
            <a
              href="https://bsky.app/settings/app-passwords"
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-400 underline"
            >
              App Password
            </a>
            .
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4 pt-2">
          <div className="flex flex-col gap-2">
            <Label htmlFor="bluesky-handle">Handle</Label>
            <Input
              id="bluesky-handle"
              placeholder="alice.bsky.social"
              value={handle}
              onChange={(e) => setHandle(e.target.value)}
              disabled={isConnecting}
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="bluesky-password">App Password</Label>
            <Input
              id="bluesky-password"
              type="password"
              placeholder="xxxx-xxxx-xxxx-xxxx"
              value={appPassword}
              onChange={(e) => setAppPassword(e.target.value)}
              disabled={isConnecting}
            />
          </div>
          <Button type="submit" disabled={isConnecting}>
            {isConnecting ? "Connecting..." : "Connect"}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/social/BlueskyConnectModal.tsx
git commit -m "feat(social): add bluesky inline connect modal with app password form"
```

---

## Task 11: Mastodon Connect Modal UI

**Files:**
- Create: `src/components/social/MastodonConnectModal.tsx`

- [ ] **Step 1: Create the two-step modal component**

Create `src/components/social/MastodonConnectModal.tsx`:

```tsx
"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { useToast } from "@/components/Toast"
import { useSocialAccountsStore } from "@/store/socialAccountsStore"

const POPULAR_INSTANCES = [
  "mastodon.social",
  "fosstodon.org",
  "hachyderm.io",
]

interface MastodonConnectModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function MastodonConnectModal({ open, onOpenChange }: MastodonConnectModalProps) {
  const [instanceUrl, setInstanceUrl] = useState("")
  const [isConnecting, setIsConnecting] = useState(false)
  const popupRef = useRef<Window | null>(null)
  const popupCheckRef = useRef<number | null>(null)
  const { show: showToast } = useToast()
  const { fetchAccounts } = useSocialAccountsStore()

  const cleanupPopup = useCallback(() => {
    if (popupCheckRef.current) {
      window.clearInterval(popupCheckRef.current)
      popupCheckRef.current = null
    }
    popupRef.current = null
  }, [])

  useEffect(() => {
    function handleOAuthMessage(event: MessageEvent) {
      if (event.origin !== window.location.origin) return
      if (event.data?.type !== "social-oauth-complete") return

      cleanupPopup()
      setIsConnecting(false)

      if (event.data.success) {
        showToast(event.data.message || "Mastodon channel connected!", "success")
        fetchAccounts()
        onOpenChange(false)
        setInstanceUrl("")
      } else {
        showToast(event.data.message || "Failed to complete connection", "error")
      }
    }

    window.addEventListener("message", handleOAuthMessage)
    return () => {
      window.removeEventListener("message", handleOAuthMessage)
      cleanupPopup()
    }
  }, [cleanupPopup, fetchAccounts, onOpenChange, showToast])

  async function handleSubmit(url: string) {
    const instance = url.trim()
    if (!instance) {
      showToast("Instance URL is required.", "error")
      return
    }

    setIsConnecting(true)
    const width = 760
    const height = 760
    const left = Math.max(0, window.screenX + (window.outerWidth - width) / 2)
    const top = Math.max(0, window.screenY + (window.outerHeight - height) / 2)
    const popup = window.open(
      "about:blank",
      "connect-mastodon",
      `width=${width},height=${height},left=${left},top=${top}`,
    )
    popupRef.current = popup

    try {
      const response = await fetch("/api/social/accounts/connect-mastodon", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ instanceUrl: instance }),
      })

      const data = await response.json()

      if (!response.ok || !data.success || !data.authUrl) {
        throw new Error(data.error || "Failed to start Mastodon connection")
      }

      if (!popup || popup.closed) {
        window.location.href = data.authUrl
        return
      }

      popup.location.href = data.authUrl
      popup.focus()
      popupCheckRef.current = window.setInterval(() => {
        if (!popup.closed) return
        cleanupPopup()
        setIsConnecting(false)
      }, 500)
    } catch (error) {
      popup?.close()
      cleanupPopup()
      showToast(
        error instanceof Error ? error.message : "Failed to connect",
        "error",
      )
      setIsConnecting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Connect Mastodon</DialogTitle>
          <DialogDescription>
            Enter your Mastodon instance or pick one below
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4 pt-2">
          <div className="flex gap-2">
            {POPULAR_INSTANCES.map((instance) => (
              <Button
                key={instance}
                variant="outline"
                size="sm"
                disabled={isConnecting}
                onClick={() => handleSubmit(instance)}
                className="text-xs"
              >
                {instance}
              </Button>
            ))}
          </div>
          <form
            onSubmit={(e) => {
              e.preventDefault()
              handleSubmit(instanceUrl)
            }}
            className="flex flex-col gap-2"
          >
            <Label htmlFor="mastodon-instance">Instance URL</Label>
            <div className="flex gap-2">
              <Input
                id="mastodon-instance"
                placeholder="mastodon.social"
                value={instanceUrl}
                onChange={(e) => setInstanceUrl(e.target.value)}
                disabled={isConnecting}
              />
              <Button type="submit" disabled={isConnecting}>
                {isConnecting ? "Connecting..." : "Connect"}
              </Button>
            </div>
          </form>
        </div>
      </DialogContent>
    </Dialog>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/social/MastodonConnectModal.tsx
git commit -m "feat(social): add mastodon two-step connect modal with instance picker"
```

---

## Task 12: Update PlatformPicker to Handle Bluesky and Mastodon

**Files:**
- Modify: `src/components/social/PlatformPicker.tsx`

- [ ] **Step 1: Import the new modals and add state**

In `src/components/social/PlatformPicker.tsx`, add imports:

```typescript
import { BlueskyConnectModal } from "./BlueskyConnectModal"
import { MastodonConnectModal } from "./MastodonConnectModal"
```

Inside the `PlatformPicker` component, add state:

```typescript
const [blueskyModalOpen, setBlueskyModalOpen] = useState(false)
const [mastodonModalOpen, setMastodonModalOpen] = useState(false)
```

- [ ] **Step 2: Update the `handleConnect` function**

Before the popup logic, add a check for custom auth flows:

```typescript
async function handleConnect(platform: string) {
  if (platform === "bluesky") {
    setBlueskyModalOpen(true)
    return
  }
  if (platform === "mastodon") {
    setMastodonModalOpen(true)
    return
  }

  // ... existing OAuth popup flow ...
}
```

- [ ] **Step 3: Render the modals**

Add before the closing `</Dialog>`:

```tsx
<BlueskyConnectModal
  open={blueskyModalOpen}
  onOpenChange={(open) => {
    setBlueskyModalOpen(open)
    if (!open) fetchAccounts()
  }}
/>
<MastodonConnectModal
  open={mastodonModalOpen}
  onOpenChange={(open) => {
    setMastodonModalOpen(open)
    if (!open) fetchAccounts()
  }}
/>
```

- [ ] **Step 4: Verify TypeScript compiles**

Run: `pnpm tsc --noEmit 2>&1 | head -20`

Expected: No type errors.

- [ ] **Step 5: Commit**

```bash
git add src/components/social/PlatformPicker.tsx
git commit -m "feat(social): wire bluesky and mastodon connect modals into platform picker"
```

---

## Task 13: Preview Components

**Files:**
- Create: `src/components/social/compose/BlueskyPreview.tsx`
- Create: `src/components/social/compose/MastodonPreview.tsx`
- Modify: `src/components/social/compose/PreviewPanel.tsx`

- [ ] **Step 1: Create BlueskyPreview**

Create `src/components/social/compose/BlueskyPreview.tsx`:

```tsx
interface BlueskyPreviewProps {
  displayName: string
  username?: string | null
  content: string
  media: { type: "image" | "video"; url: string; alt?: string; mimeType?: string }[]
}

export function BlueskyPreview({ displayName, username, content, media }: BlueskyPreviewProps) {
  const images = media.filter((m) => m.type === "image").slice(0, 4)

  return (
    <div className="overflow-hidden rounded-lg border border-border bg-card text-card-foreground">
      <div className="p-3">
        <div className="flex items-start gap-2.5">
          <div className="size-10 shrink-0 rounded-full bg-muted" />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1">
              <span className="truncate text-sm font-semibold">{displayName}</span>
              <span className="truncate text-xs text-muted-foreground">
                @{username || "handle"}
              </span>
            </div>
            <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed">
              {content}
            </p>
            {images.length > 0 && (
              <div
                className={`mt-2 grid gap-0.5 overflow-hidden rounded-lg ${
                  images.length === 1
                    ? "grid-cols-1"
                    : "grid-cols-2"
                }`}
              >
                {images.map((img, i) => (
                  <img
                    key={i}
                    src={img.url}
                    alt={img.alt || ""}
                    className={`w-full object-cover ${
                      images.length === 1
                        ? "aspect-video"
                        : images.length === 3 && i === 0
                          ? "row-span-2 aspect-square"
                          : "aspect-square"
                    }`}
                  />
                ))}
              </div>
            )}
            <div className="mt-2 flex items-center gap-6 text-xs text-muted-foreground">
              <span>Reply</span>
              <span>Repost</span>
              <span>Like</span>
              <span>More</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Create MastodonPreview**

Create `src/components/social/compose/MastodonPreview.tsx`:

```tsx
interface MastodonPreviewProps {
  displayName: string
  username?: string | null
  content: string
  media: { type: "image" | "video"; url: string; alt?: string; mimeType?: string }[]
}

export function MastodonPreview({ displayName, username, content, media }: MastodonPreviewProps) {
  const images = media.filter((m) => m.type === "image").slice(0, 4)

  return (
    <div className="overflow-hidden rounded-lg border border-border bg-card text-card-foreground">
      <div className="p-3">
        <div className="flex items-start gap-2.5">
          <div className="size-10 shrink-0 rounded-full bg-muted" />
          <div className="min-w-0 flex-1">
            <div className="flex flex-col">
              <span className="text-sm font-semibold">{displayName}</span>
              <span className="text-xs text-muted-foreground">
                @{username || "user"}
              </span>
            </div>
            <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed">
              {content}
            </p>
            {images.length > 0 && (
              <div
                className={`mt-2 grid gap-0.5 overflow-hidden rounded-lg ${
                  images.length === 1
                    ? "grid-cols-1"
                    : "grid-cols-2"
                }`}
              >
                {images.map((img, i) => (
                  <img
                    key={i}
                    src={img.url}
                    alt={img.alt || ""}
                    className={`w-full object-cover ${
                      images.length === 1 ? "aspect-video" : "aspect-square"
                    }`}
                  />
                ))}
              </div>
            )}
            <div className="mt-2 flex items-center gap-6 text-xs text-muted-foreground">
              <span>Reply</span>
              <span>Boost</span>
              <span>Favourite</span>
              <span>Bookmark</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Register both previews in PreviewPanel**

In `src/components/social/compose/PreviewPanel.tsx`, add imports:

```typescript
import { BlueskyPreview } from "./BlueskyPreview"
import { MastodonPreview } from "./MastodonPreview"
```

Add to `PREVIEW_COMPONENTS`:

```typescript
bluesky: BlueskyPreview,
mastodon: MastodonPreview,
```

- [ ] **Step 4: Verify TypeScript compiles**

Run: `pnpm tsc --noEmit 2>&1 | head -20`

Expected: No type errors.

- [ ] **Step 5: Commit**

```bash
git add src/components/social/compose/BlueskyPreview.tsx src/components/social/compose/MastodonPreview.tsx src/components/social/compose/PreviewPanel.tsx
git commit -m "feat(social): add bluesky and mastodon live preview components in compose"
```

---

## Task 14: Mastodon Publishing Settings UI

**Files:**
- Modify: `src/components/social/compose/PublishingSettingsPanels.tsx`

- [ ] **Step 1: Add Mastodon settings fields**

In `src/components/social/compose/PublishingSettingsPanels.tsx`, add a `MastodonSettings` component and wire it into `PlatformSettingsFields`:

```tsx
function MastodonSettings({
  settings,
  update,
}: {
  settings: Record<string, unknown>
  update: (key: string, value: unknown) => void
}) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <Label className="text-xs">Visibility</Label>
        <select
          value={(settings.visibility as string) || "public"}
          onChange={(e) => update("visibility", e.target.value)}
          className="rounded-md border border-border bg-background px-3 py-1.5 text-sm"
        >
          <option value="public">Public</option>
          <option value="unlisted">Unlisted</option>
          <option value="private">Followers only</option>
          <option value="direct">Mentioned only</option>
        </select>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label className="text-xs">Content Warning</Label>
        <Input
          placeholder="Optional warning text"
          value={(settings.contentWarning as string) || ""}
          onChange={(e) => update("contentWarning", e.target.value)}
          className="text-sm"
        />
      </div>
    </div>
  )
}
```

In the `PlatformSettingsFields` component, add the mastodon branch:

```typescript
if (platform === "mastodon") return <MastodonSettings settings={settings} update={update} />
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `pnpm tsc --noEmit 2>&1 | head -20`

Expected: No type errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/social/compose/PublishingSettingsPanels.tsx
git commit -m "feat(social): add mastodon visibility and content warning to compose settings"
```

---

## Task 15: Client Functions for New Connect Flows

**Files:**
- Modify: `src/lib/social/client.ts`

- [ ] **Step 1: Add client functions**

In `src/lib/social/client.ts`, add:

```typescript
export async function connectBluesky(
  handle: string,
  appPassword: string,
): Promise<{ success: boolean; account?: { id: string; platform: string; displayName: string; username: string | null }; error?: string }> {
  const response = await fetch("/api/social/accounts/connect-bluesky", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ handle, appPassword }),
  })
  return response.json()
}

export async function connectMastodon(
  instanceUrl: string,
): Promise<{ success: boolean; authUrl?: string; error?: string }> {
  const response = await fetch("/api/social/accounts/connect-mastodon", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ instanceUrl }),
  })
  return response.json()
}
```

- [ ] **Step 2: Update BlueskyConnectModal and MastodonConnectModal to use the client functions**

In `BlueskyConnectModal.tsx`, replace the inline fetch with:

```typescript
import { connectBluesky } from "@/lib/social/client"

// In handleSubmit:
const data = await connectBluesky(handle.trim(), appPassword.trim())
if (!data.success) {
  throw new Error(data.error || "Failed to connect Bluesky account")
}
```

In `MastodonConnectModal.tsx`, replace the inline fetch with:

```typescript
import { connectMastodon } from "@/lib/social/client"

// In handleSubmit:
const data = await connectMastodon(instance)
if (!data.success || !data.authUrl) {
  throw new Error(data.error || "Failed to start Mastodon connection")
}
```

- [ ] **Step 3: Commit**

```bash
git add src/lib/social/client.ts src/components/social/BlueskyConnectModal.tsx src/components/social/MastodonConnectModal.tsx
git commit -m "feat(social): add client functions for bluesky and mastodon connect flows"
```

---

## Task 16: Run Full Test Suite and Verify

**Files:** None (verification only)

- [ ] **Step 1: Run the full social test suite**

Run: `pnpm vitest run src/lib/social/`

Expected: All existing tests still pass, plus new tests for bluesky, mastodon, bluesky-facets, and publishing settings.

- [ ] **Step 2: Run TypeScript check**

Run: `pnpm tsc --noEmit`

Expected: No type errors.

- [ ] **Step 3: Run the dev server and verify**

Run: `pnpm dev`

Verify manually:
1. Navigate to `/social/channels`
2. Click "Connect a channel" — Bluesky and Mastodon should appear in the picker grid
3. Click Bluesky — inline modal appears with handle + app password fields
4. Click Mastodon — two-step modal appears with instance picker + custom URL input
5. Navigate to `/social/compose` — Bluesky and Mastodon previews render for connected accounts
6. Mastodon compose shows visibility dropdown and content warning input

- [ ] **Step 4: Final commit if any fixes needed**

```bash
git add -A
git commit -m "fix(social): address bluesky and mastodon integration issues"
```
