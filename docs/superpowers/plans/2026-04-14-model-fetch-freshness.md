# Model Fetch Freshness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** New models from Replicate/Fal/WaveSpeed surface within minutes of upstream release (instead of up to 48h), and Gemini discovery of new Google models via `v1beta/models` supplements the existing hardcoded list.

**Architecture:** Three isolated changes — (1) client-side SWR in `ModelSearchDialog.tsx`, (2) server-side search-miss retry in `/api/models/route.ts`, (3) server-side Gemini hybrid discovery in `/api/models/route.ts`. Each ships, tests, and reverts independently.

**Tech Stack:** Next.js 16 App Router, TypeScript, Vitest (server tests), Zustand (client store — read-only here), `@xyflow/react` (adjacent but untouched), Google Generative Language REST API (`generativelanguage.googleapis.com/v1beta/models`).

**Spec:** `docs/superpowers/specs/2026-04-14-model-fetch-freshness-design.md`

**Branch:** `feature/model-fetch-freshness` (already created from `develop`).

---

## File Structure

| File | Role | Change |
|------|------|--------|
| `src/app/api/models/route.ts` | Server route — aggregates providers, handles caching | Add `humanize()`, `fetchGeminiModels()`, revalidation-throttle map, search-miss retry block; replace hardcoded-only Gemini branch with hybrid discovery |
| `src/components/modals/ModelSearchDialog.tsx` | Client — model search UI + fetch logic | Modify `fetchModels()` to implement stale-while-revalidate |
| `src/app/api/models/__tests__/route.test.ts` | Existing vitest test file for the route | Extend with 7 new test cases (Tasks 2, 3, 4) |

No new files created. All changes colocated with the code they modify.

---

## Task 1: Add `humanize()` helper

**Files:**
- Modify: `src/app/api/models/route.ts` (top-level helper section, near `filterModelsBySearch` at line 648)
- Test: `src/app/api/models/__tests__/route.test.ts`

Why this task exists: `fetchGeminiModels` (Task 2) needs `humanize` to convert raw model IDs like `gemini-4-pro-image-preview` into display names. TDD-driven, tiny, self-contained.

- [ ] **Step 1.1: Write the failing test**

Append to `src/app/api/models/__tests__/route.test.ts` inside the existing `describe("/api/models route", () => { ... })`:

```ts
  describe("humanize helper", () => {
    it("converts kebab-case id to Title Case", async () => {
      const { humanize } = await import("../route");
      expect(humanize("gemini-4-pro-image-preview")).toBe("Gemini 4 Pro Image Preview");
    });

    it("handles snake_case ids", async () => {
      const { humanize } = await import("../route");
      expect(humanize("veo_3_fast")).toBe("Veo 3 Fast");
    });

    it("handles single-word ids", async () => {
      const { humanize } = await import("../route");
      expect(humanize("veo")).toBe("Veo");
    });

    it("preserves numeric segments", async () => {
      const { humanize } = await import("../route");
      expect(humanize("gemini-2.5-flash")).toBe("Gemini 2.5 Flash");
    });
  });
```

- [ ] **Step 1.2: Run test to verify it fails**

Run: `pnpm vitest run src/app/api/models/__tests__/route.test.ts -t "humanize helper"`

Expected: 4 failures with `humanize is not a function` or import error (function not yet exported).

- [ ] **Step 1.3: Implement `humanize` and export it**

In `src/app/api/models/route.ts`, add near the other top-level helpers (after `filterModelsBySearch`, around line 660):

```ts
/**
 * Convert a raw model id (kebab-case, snake_case, dot-separated) to a display
 * name by title-casing each segment.
 *
 * humanize("gemini-4-pro-image-preview") → "Gemini 4 Pro Image Preview"
 * humanize("veo_3_fast")                 → "Veo 3 Fast"
 * humanize("gemini-2.5-flash")           → "Gemini 2.5 Flash"
 */
export function humanize(id: string): string {
  return id
    .split(/[-_]/)
    .map((segment) =>
      segment.length === 0
        ? segment
        : segment[0].toUpperCase() + segment.slice(1)
    )
    .join(" ");
}
```

- [ ] **Step 1.4: Run tests to verify they pass**

Run: `pnpm vitest run src/app/api/models/__tests__/route.test.ts -t "humanize helper"`

Expected: 4 passed.

- [ ] **Step 1.5: Commit**

```bash
git add src/app/api/models/route.ts src/app/api/models/__tests__/route.test.ts
git commit -m "feat(models): add humanize helper for deriving display names"
```

---

## Task 2: Add `fetchGeminiModels()` discovery function

**Files:**
- Modify: `src/app/api/models/route.ts` (add new function + inference helper below the existing WaveSpeed/Fal helpers, around line 935)
- Test: `src/app/api/models/__tests__/route.test.ts`

Why this task exists: discovery is the core of Gemini hybrid merge. Implementing + testing it in isolation (before wiring into `GET`) makes the failure surface smaller.

- [ ] **Step 2.1: Write the failing test**

Append to the existing test file inside the main `describe("/api/models route", ...)`:

```ts
  describe("fetchGeminiModels", () => {
    beforeEach(() => {
      global.fetch = mockFetch as unknown as typeof global.fetch;
    });

    afterEach(() => {
      global.fetch = originalFetch;
    });

    it("returns only image/video models from the discovery response", async () => {
      const { fetchGeminiModels } = await import("../route");

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            models: [
              { name: "models/gemini-4-pro-image-preview", supportedGenerationMethods: ["generateContent"] },
              { name: "models/veo-4-ultra", supportedGenerationMethods: ["predictLongRunning"] },
              { name: "models/gemini-2.5-flash", supportedGenerationMethods: ["generateContent"] },
              { name: "models/text-embedding-004", supportedGenerationMethods: ["embedContent"] },
            ],
          }),
      });

      const result = await fetchGeminiModels("fake-key");

      expect(result.map((m) => m.id).sort()).toEqual(["gemini-4-pro-image-preview", "veo-4-ultra"]);
    });

    it("infers image capabilities for ids containing 'image'", async () => {
      const { fetchGeminiModels } = await import("../route");

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            models: [{ name: "models/gemini-4-pro-image-preview", supportedGenerationMethods: ["generateContent"] }],
          }),
      });

      const result = await fetchGeminiModels("fake-key");
      expect(result[0]).toMatchObject({
        id: "gemini-4-pro-image-preview",
        name: "Gemini 4 Pro Image Preview",
        provider: "gemini",
        capabilities: ["text-to-image", "image-to-image"],
      });
      expect(result[0].pricing).toBeUndefined();
      expect(result[0].coverImage).toBeUndefined();
    });

    it("infers video capabilities for veo-* ids", async () => {
      const { fetchGeminiModels } = await import("../route");

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            models: [{ name: "models/veo-4-ultra", supportedGenerationMethods: ["predictLongRunning"] }],
          }),
      });

      const result = await fetchGeminiModels("fake-key");
      expect(result[0].capabilities).toEqual(["text-to-video", "image-to-video"]);
    });

    it("returns [] on HTTP error", async () => {
      const { fetchGeminiModels } = await import("../route");

      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 403,
        statusText: "Forbidden",
      });

      const result = await fetchGeminiModels("bad-key");
      expect(result).toEqual([]);
    });

    it("returns [] on network throw", async () => {
      const { fetchGeminiModels } = await import("../route");

      mockFetch.mockRejectedValueOnce(new Error("network down"));

      const result = await fetchGeminiModels("fake-key");
      expect(result).toEqual([]);
    });

    it("paginates when nextPageToken is present", async () => {
      const { fetchGeminiModels } = await import("../route");

      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () =>
            Promise.resolve({
              models: [{ name: "models/gemini-5-image", supportedGenerationMethods: ["generateContent"] }],
              nextPageToken: "page2",
            }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () =>
            Promise.resolve({
              models: [{ name: "models/veo-5", supportedGenerationMethods: ["predictLongRunning"] }],
            }),
        });

      const result = await fetchGeminiModels("fake-key");
      expect(result.map((m) => m.id).sort()).toEqual(["gemini-5-image", "veo-5"]);
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });
  });
```

- [ ] **Step 2.2: Run tests to verify they fail**

Run: `pnpm vitest run src/app/api/models/__tests__/route.test.ts -t "fetchGeminiModels"`

Expected: 6 failures with `fetchGeminiModels is not a function` or import error.

- [ ] **Step 2.3: Implement `fetchGeminiModels`**

Add the following in `src/app/api/models/route.ts` after the `fetchWaveSpeedModels` function (around line 853). The `humanize` import from the same module is already available since it's in the same file.

```ts
// ============ Gemini Discovery ============

const GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta";
const GEMINI_DISCOVERY_TIMEOUT_MS = 5000;

interface GeminiDiscoveryModel {
  name: string; // e.g. "models/gemini-4-pro-image-preview"
  supportedGenerationMethods?: string[];
}

interface GeminiDiscoveryResponse {
  models?: GeminiDiscoveryModel[];
  nextPageToken?: string;
}

function inferGeminiCapabilities(id: string): ModelCapability[] | null {
  const lower = id.toLowerCase();
  if (lower.includes("image")) {
    return ["text-to-image", "image-to-image"];
  }
  if (lower.startsWith("veo-") || lower.includes("video")) {
    return ["text-to-video", "image-to-video"];
  }
  return null;
}

/**
 * Discover Gemini models via the Google Generative Language API.
 *
 * Filters to image/video generation models only. Returns [] on any failure
 * (network, auth, malformed response, timeout) — caller is expected to fall
 * back to the hardcoded list.
 *
 * Timeout: 5s total across all pages (shared AbortSignal).
 */
export async function fetchGeminiModels(apiKey: string): Promise<ProviderModel[]> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), GEMINI_DISCOVERY_TIMEOUT_MS);

  try {
    const discovered: ProviderModel[] = [];
    let pageToken: string | undefined;
    let pageCount = 0;
    const maxPages = 10; // safety bound

    do {
      const url = new URL(`${GEMINI_API_BASE}/models`);
      url.searchParams.set("key", apiKey);
      url.searchParams.set("pageSize", "100");
      if (pageToken) url.searchParams.set("pageToken", pageToken);

      const response = await fetch(url.toString(), { signal: controller.signal });
      if (!response.ok) {
        console.warn(`[Models] gemini discovery HTTP ${response.status}`);
        return [];
      }

      const data = (await response.json()) as GeminiDiscoveryResponse;
      const models = data.models ?? [];

      for (const model of models) {
        const rawId = model.name.replace(/^models\//, "");
        const capabilities = inferGeminiCapabilities(rawId);
        if (!capabilities) continue;

        discovered.push({
          id: rawId,
          name: humanize(rawId),
          description: "Newly discovered Gemini model. Metadata may be incomplete.",
          provider: "gemini",
          capabilities,
        });
      }

      pageToken = data.nextPageToken;
      pageCount++;
    } while (pageToken && pageCount < maxPages);

    return discovered;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`[Models] gemini discovery failed: ${message}`);
    return [];
  } finally {
    clearTimeout(timeoutId);
  }
}
```

- [ ] **Step 2.4: Run tests to verify they pass**

Run: `pnpm vitest run src/app/api/models/__tests__/route.test.ts -t "fetchGeminiModels"`

Expected: 6 passed.

- [ ] **Step 2.5: Commit**

```bash
git add src/app/api/models/route.ts src/app/api/models/__tests__/route.test.ts
git commit -m "feat(models): add Gemini discovery via v1beta/models endpoint"
```

---

## Task 3: Wire Gemini hybrid discovery into GET handler

**Files:**
- Modify: `src/app/api/models/route.ts` (the `includeGemini` branch in the `GET` handler, currently at lines 1040–1053)
- Test: `src/app/api/models/__tests__/route.test.ts`

Why this task exists: now that `fetchGeminiModels` works in isolation, merge it into the actual request flow with cache + hardcoded-wins-on-collision semantics.

- [ ] **Step 3.1: Write the failing test**

Append to the test file:

```ts
  describe("Gemini hybrid discovery in GET", () => {
    beforeEach(() => {
      global.fetch = mockFetch as unknown as typeof global.fetch;
      process.env.GEMINI_API_KEY = "test-gemini-key";
    });

    afterEach(() => {
      global.fetch = originalFetch;
      delete process.env.GEMINI_API_KEY;
    });

    it("merges discovered models with hardcoded list (hardcoded wins on collision)", async () => {
      // Discovery returns "nano-banana" (which is already hardcoded) plus a new "gemini-9-image"
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            models: [
              { name: "models/nano-banana", supportedGenerationMethods: ["generateContent"] },
              { name: "models/gemini-9-image", supportedGenerationMethods: ["generateContent"] },
            ],
          }),
      });

      const request = createMockGetRequest({ provider: "gemini" });
      const response = await GET(request);
      const data = await response.json();

      expect(data.success).toBe(true);

      const geminiModels = data.models.filter((m: { provider: string }) => m.provider === "gemini");
      const nanoBanana = geminiModels.find((m: { id: string }) => m.id === "nano-banana");
      const newModel = geminiModels.find((m: { id: string }) => m.id === "gemini-9-image");

      // Hardcoded wins: description/pricing from hardcoded, NOT from discovery stub
      expect(nanoBanana.description).toContain("Fast image generation");
      expect(nanoBanana.pricing).toEqual({ type: "per-run", amount: 0.039, currency: "USD" });

      // Discovered-only model has the stub shape
      expect(newModel).toMatchObject({
        name: "Gemini 9 Image",
        description: "Newly discovered Gemini model. Metadata may be incomplete.",
        capabilities: ["text-to-image", "image-to-image"],
      });
      expect(newModel.pricing).toBeUndefined();
    });

    it("falls back to hardcoded list when discovery fails", async () => {
      mockFetch.mockRejectedValueOnce(new Error("boom"));

      const request = createMockGetRequest({ provider: "gemini" });
      const response = await GET(request);
      const data = await response.json();

      expect(data.success).toBe(true);
      const ids = data.models.map((m: { id: string }) => m.id);
      expect(ids).toContain("nano-banana");
      expect(ids).toContain("nano-banana-2");
      // No discovered-only models present
      expect(ids.every((id: string) => !id.startsWith("gemini-9"))).toBe(true);
    });

    it("skips discovery and returns hardcoded only when GEMINI_API_KEY missing", async () => {
      delete process.env.GEMINI_API_KEY;

      const request = createMockGetRequest({ provider: "gemini" });
      const response = await GET(request);
      const data = await response.json();

      expect(data.success).toBe(true);
      expect(mockFetch).not.toHaveBeenCalled();
      const ids = data.models.map((m: { id: string }) => m.id);
      expect(ids).toContain("nano-banana");
    });

    it("uses cached discovery when available", async () => {
      // Prime cache with a discovered model
      mockGetCachedModels.mockImplementation((key: string) => {
        if (key === "gemini:models") {
          return [
            {
              id: "cached-gemini-model",
              name: "Cached Gemini Model",
              description: "From cache",
              provider: "gemini",
              capabilities: ["text-to-image", "image-to-image"],
            },
          ];
        }
        return null;
      });

      const request = createMockGetRequest({ provider: "gemini" });
      const response = await GET(request);
      const data = await response.json();

      expect(mockFetch).not.toHaveBeenCalled();
      const ids = data.models.map((m: { id: string }) => m.id);
      expect(ids).toContain("cached-gemini-model");

      // Reset the cache mock so it doesn't leak to subsequent tests
      mockGetCachedModels.mockReturnValue(null);
    });
  });
```

- [ ] **Step 3.2: Run tests to verify they fail**

Run: `pnpm vitest run src/app/api/models/__tests__/route.test.ts -t "Gemini hybrid discovery"`

Expected: 4 failures — current code returns only the hardcoded list and does not attempt discovery.

- [ ] **Step 3.3: Replace the `includeGemini` branch in the GET handler**

In `src/app/api/models/route.ts`, locate the block starting at line 1040:

```ts
  // Add Gemini models first if included (they appear at the top)
  if (includeGemini) {
    // Filter by search query if provided
    let geminiModels = [...GEMINI_IMAGE_MODELS, ...GEMINI_VIDEO_MODELS];
    if (searchQuery) {
      geminiModels = filterModelsBySearch(geminiModels, searchQuery);
    }
    allModels.push(...geminiModels);
    providerResults["gemini"] = {
      success: true,
      count: geminiModels.length,
      cached: true, // Hardcoded models are effectively "cached"
    };
    anyFromCache = true;
  }
```

Replace it with:

```ts
  // Add Gemini models first if included (they appear at the top)
  if (includeGemini) {
    const hardcoded = [...GEMINI_IMAGE_MODELS, ...GEMINI_VIDEO_MODELS];

    // Discovery is additive: try cache first, then fresh fetch, then fall back to empty.
    let discovered: ProviderModel[] = [];
    let discoveryFromCache = false;
    const geminiKey = process.env.GEMINI_API_KEY;

    if (geminiKey) {
      const cacheKey = getCacheKey("gemini");
      const cached = refresh ? null : getCachedModels(cacheKey);
      if (cached) {
        discovered = cached;
        discoveryFromCache = true;
        anyFromCache = true;
      } else {
        discovered = await fetchGeminiModels(geminiKey);
        if (discovered.length > 0) {
          setCachedModels(cacheKey, discovered);
        }
        allFromCache = false;
      }
    }

    // Hardcoded wins on ID collision
    const hardcodedIds = new Set(hardcoded.map((m) => m.id));
    const additions = discovered.filter((m) => !hardcodedIds.has(m.id));
    let geminiModels: ProviderModel[] = [...hardcoded, ...additions];

    if (searchQuery) {
      geminiModels = filterModelsBySearch(geminiModels, searchQuery);
    }

    allModels.push(...geminiModels);
    providerResults["gemini"] = {
      success: true,
      count: geminiModels.length,
      cached: discoveryFromCache,
    };
    if (discoveryFromCache) {
      anyFromCache = true;
    }
  }
```

- [ ] **Step 3.4: Run the Gemini tests to verify they pass**

Run: `pnpm vitest run src/app/api/models/__tests__/route.test.ts -t "Gemini hybrid discovery"`

Expected: 4 passed.

- [ ] **Step 3.5: Run the full test file to confirm no regressions**

Run: `pnpm vitest run src/app/api/models/__tests__/route.test.ts`

Expected: all tests pass (new tests + all pre-existing ones). If any pre-existing test asserts a specific hardcoded-only count for the Gemini provider, update it to allow extra discovered models OR add an explicit "no discovery" setup (delete `GEMINI_API_KEY`) to those tests.

- [ ] **Step 3.6: Commit**

```bash
git add src/app/api/models/route.ts src/app/api/models/__tests__/route.test.ts
git commit -m "feat(models): hybrid Gemini discovery in GET handler"
```

---

## Task 4: Server-side search-miss retry with throttle

**Files:**
- Modify: `src/app/api/models/route.ts` (add throttle map near top; add retry block in `GET` after provider loop, currently around line 1147)
- Test: `src/app/api/models/__tests__/route.test.ts`

Why this task exists: this is the change that directly fixes the user-visible "I searched for seedance-3 and got nothing" case. Independent of Gemini work.

- [ ] **Step 4.1: Write the failing test**

Append to the test file:

```ts
  describe("Search-miss retry", () => {
    beforeEach(() => {
      global.fetch = mockFetch as unknown as typeof global.fetch;
      process.env.REPLICATE_API_KEY = "fake-replicate-key";
      // Ensure Gemini discovery is a no-op (no key, so it won't fire)
      delete process.env.GEMINI_API_KEY;
    });

    afterEach(() => {
      global.fetch = originalFetch;
      delete process.env.REPLICATE_API_KEY;
    });

    it("retries with cache bypass when cache-hit returned zero matches for search", async () => {
      // Cache returns an empty list for the Replicate base key
      mockGetCachedModels.mockImplementation((key: string) => {
        if (key === "replicate:models") return [];
        return null;
      });

      // First fresh fetch (cache-bypass retry) returns seedance-3
      mockFetch.mockResolvedValueOnce(
        createReplicateResponse(
          [{ owner: "bytedance", name: "seedance-3", description: "new video model" }],
          null
        )
      );

      const request = createMockGetRequest({ search: "seedance-3", provider: "replicate" });
      const response = await GET(request);
      const data = await response.json();

      expect(data.success).toBe(true);
      expect(data.models.some((m: { id: string }) => m.id.includes("seedance-3"))).toBe(true);
      // Confirm the fresh replicate call happened
      expect(mockFetch).toHaveBeenCalledTimes(1);
      // Confirm cache was rewritten
      expect(mockSetCachedModels).toHaveBeenCalledWith("replicate:models", expect.any(Array));

      // Reset
      mockGetCachedModels.mockReturnValue(null);
    });

    it("does NOT retry when refresh=true is already set", async () => {
      mockGetCachedModels.mockReturnValue(null); // force fresh fetch path anyway
      mockFetch.mockResolvedValueOnce(createReplicateResponse([], null));

      const request = createMockGetRequest({
        search: "nonexistent-model",
        provider: "replicate",
        refresh: "true",
      });
      const response = await GET(request);
      await response.json();

      // Only ONE fetch call: the initial refresh=true fetch. No retry on top.
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it("does NOT retry when no providers were cache-hit", async () => {
      mockGetCachedModels.mockReturnValue(null); // all cache misses
      mockFetch.mockResolvedValueOnce(createReplicateResponse([], null));

      const request = createMockGetRequest({ search: "nothing", provider: "replicate" });
      const response = await GET(request);
      await response.json();

      // Only the initial fetch; no retry since we weren't serving from cache
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it("does NOT retry within 60s of a previous retry for the same cache key", async () => {
      mockGetCachedModels.mockImplementation((key: string) => {
        if (key === "replicate:models") return [];
        return null;
      });

      // First request: retry fires, returns empty
      mockFetch.mockResolvedValueOnce(createReplicateResponse([], null));
      const r1 = await GET(createMockGetRequest({ search: "unicorn", provider: "replicate" }));
      await r1.json();
      expect(mockFetch).toHaveBeenCalledTimes(1);

      // Second request within throttle window: NO retry, no fetch
      const r2 = await GET(createMockGetRequest({ search: "unicorn", provider: "replicate" }));
      const data2 = await r2.json();
      expect(mockFetch).toHaveBeenCalledTimes(1); // unchanged
      expect(data2.models).toEqual([]);

      // Reset
      mockGetCachedModels.mockReturnValue(null);
    });
  });
```

- [ ] **Step 4.2: Run tests to verify they fail**

Run: `pnpm vitest run src/app/api/models/__tests__/route.test.ts -t "Search-miss retry"`

Expected: 4 failures (no retry logic yet — the first test will see zero fetch calls, others will see different mismatches).

- [ ] **Step 4.3: Add the throttle map near the top of `route.ts`**

After the constants block (around line 44, after `WAVESPEED_API_BASE`):

```ts
// Search-miss retry throttle: per-cache-key timestamp of last cache-bypass retry.
// Prevents repeated upstream calls for gibberish searches.
const SEARCH_MISS_RETRY_THROTTLE_MS = 60_000;
const searchMissRetryThrottle = new Map<string, number>();
```

- [ ] **Step 4.4: Add the retry block in the GET handler**

In `src/app/api/models/route.ts`, locate the comment at line 1149 (`// Check if we got any models`). Insert the retry block **before** that comment.

Current code (around line 1147):

```ts
    // Add to results
    allModels.push(...models);
    providerResults[provider] = {
      success: true,
      count: models.length,
      cached: fromCache,
    };
  }

  // Check if we got any models
```

Insert the retry block between the closing `}` of the provider loop and the `// Check if we got any models` comment:

```ts
  }

  // Search-miss retry: if a search yielded zero matches but results came from cache,
  // bypass cache once for the cache-hit providers and retry upstream.
  if (
    searchQuery &&
    !refresh &&
    allModels.length === 0 &&
    anyFromCache
  ) {
    const cacheHitProviders = Object.entries(providerResults)
      .filter(([, result]) => result.success && result.cached)
      .map(([provider]) => provider as ProviderType)
      .filter((p) => p === "replicate" || p === "fal" || p === "wavespeed");

    for (const provider of cacheHitProviders) {
      const cacheKey =
        provider === "replicate" || provider === "wavespeed"
          ? getCacheKey(provider)
          : getCacheKey(provider, searchQuery);

      // Throttle: skip if this cache key was revalidated within the window
      const lastRetry = searchMissRetryThrottle.get(cacheKey) ?? 0;
      if (Date.now() - lastRetry < SEARCH_MISS_RETRY_THROTTLE_MS) {
        continue;
      }
      searchMissRetryThrottle.set(cacheKey, Date.now());

      try {
        let fresh: ProviderModel[] = [];
        if (provider === "replicate") {
          const all = await fetchReplicateModels(replicateKey!);
          setCachedModels(cacheKey, all);
          fresh = searchQuery ? filterModelsBySearch(all, searchQuery) : all;
        } else if (provider === "fal") {
          fresh = await fetchFalModels(falKey, searchQuery);
          setCachedModels(cacheKey, fresh);
        } else if (provider === "wavespeed") {
          const all = await fetchWaveSpeedModels(wavespeedKey!);
          setCachedModels(cacheKey, all);
          fresh = searchQuery ? filterModelsBySearch(all, searchQuery) : all;
        }
        allModels.push(...fresh);
        providerResults[provider] = {
          success: true,
          count: fresh.length,
          cached: false,
        };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : "Unknown error";
        console.warn(`[Models] ${provider} search-miss retry failed: ${errorMessage}`);
        // Leave the original empty-but-cached result in place
      }
    }
  }

  // Check if we got any models
```

- [ ] **Step 4.5: Run the search-miss tests to verify they pass**

Run: `pnpm vitest run src/app/api/models/__tests__/route.test.ts -t "Search-miss retry"`

Expected: 4 passed.

- [ ] **Step 4.6: Run the full test file to confirm no regressions**

Run: `pnpm vitest run src/app/api/models/__tests__/route.test.ts`

Expected: all tests pass.

- [ ] **Step 4.7: Commit**

```bash
git add src/app/api/models/route.ts src/app/api/models/__tests__/route.test.ts
git commit -m "feat(models): server-side search-miss retry with 60s throttle"
```

---

## Task 5: Client-side stale-while-revalidate

**Files:**
- Modify: `src/components/modals/ModelSearchDialog.tsx` (the `fetchModels` function at lines 175–272)

Why this task exists: ensures users see fresh data on dialog open without ever seeing a loading spinner for a cache-hit. Per spec, no unit tests — manual QA only.

- [ ] **Step 5.1: Modify `fetchModels` to implement SWR**

In `src/components/modals/ModelSearchDialog.tsx`, locate the `fetchModels` function at line 175. Replace the entire function body (keeping the `useCallback` wrapper and dependencies) with:

```ts
  // Fetch models with stale-while-revalidate: cache-hit returns immediately, then a
  // background revalidate silently refreshes state + localStorage if upstream differs.
  const fetchModels = useCallback(async (bypassCache = false) => {
    // Increment version to track this request
    const thisVersion = ++requestVersionRef.current;

    // Build cache key from filters
    const cacheKey = `${providerFilter}:${capabilityFilter}:${debouncedSearch}`;

    // Helper: build query params + headers for an API call
    const buildRequest = (forceRefresh: boolean) => {
      const params = new URLSearchParams();
      if (debouncedSearch) params.set("search", debouncedSearch);
      if (providerFilter !== "all") params.set("provider", providerFilter);
      if (capabilityFilter !== "all") {
        const capabilities =
          capabilityFilter === "image"
            ? "text-to-image,image-to-image"
            : capabilityFilter === "video"
            ? "text-to-video,image-to-video"
            : capabilityFilter === "3d"
            ? "text-to-3d,image-to-3d"
            : "text-to-audio";
        params.set("capabilities", capabilities);
      }
      if (forceRefresh) params.set("refresh", "true");

      const headers: Record<string, string> = {};
      if (replicateApiKey) headers["X-Replicate-Key"] = replicateApiKey;
      if (falApiKey) headers["X-Fal-Key"] = falApiKey;
      if (kieApiKey) headers["X-Kie-Key"] = kieApiKey;
      if (wavespeedApiKey) headers["X-WaveSpeed-Key"] = wavespeedApiKey;

      return { params, headers };
    };

    // Helper: hash the model list by length + sorted id signature. Used to detect
    // whether an SWR revalidation response actually changed anything.
    const signature = (models: ProviderModel[]): string =>
      `${models.length}:${models
        .map((m) => m.id)
        .sort()
        .join(",")}`;

    // Check localStorage cache first (skip when bypassing)
    const cached = bypassCache ? null : getCachedModels(cacheKey);
    if (cached) {
      // Serve cached immediately, no spinner
      setModels(cached.models);
      if (cached.availableProviders) {
        setServerAvailableProviders(cached.availableProviders);
      }

      // Background revalidate: fire and forget, only update if response differs
      (async () => {
        try {
          const { params, headers } = buildRequest(false);
          const response = await deduplicatedFetch(`/api/models?${params.toString()}`, {
            headers,
          });

          // Drop if filters changed while we were in flight
          if (thisVersion !== requestVersionRef.current) return;

          const data: ModelsResponse = await response.json();
          if (!data.success || !data.models) return;

          const cachedSig = signature(cached.models);
          const freshSig = signature(data.models);
          if (cachedSig !== freshSig) {
            console.debug("[ModelSearch] SWR detected diff, updating", {
              cachedCount: cached.models.length,
              freshCount: data.models.length,
            });
            setModels(data.models);
            setCachedModels(cacheKey, data.models, data.availableProviders);
            if (data.availableProviders) {
              setServerAvailableProviders(data.availableProviders);
            }
          }
        } catch (err) {
          // Silent: cached data is still good. Log for devtools.
          console.warn("[ModelSearch] SWR revalidate failed:", err);
        }
      })();

      return;
    }

    // Cache miss: show spinner and fetch normally
    setIsLoading(true);
    setError(null);

    try {
      const { params, headers } = buildRequest(bypassCache);
      const response = await deduplicatedFetch(`/api/models?${params.toString()}`, {
        headers,
      });

      // Check if this request is still current
      if (thisVersion !== requestVersionRef.current) {
        return; // Ignore stale response
      }

      const data: ModelsResponse = await response.json();

      if (data.success && data.models) {
        setModels(data.models);
        setCachedModels(cacheKey, data.models, data.availableProviders);
        if (data.availableProviders) {
          setServerAvailableProviders(data.availableProviders);
        }
      } else {
        setError(data.error || "Failed to fetch models");
        setModels([]);
      }
    } catch (err) {
      if (thisVersion !== requestVersionRef.current) {
        return;
      }
      setError(err instanceof Error ? err.message : "Failed to fetch models");
      setModels([]);
    } finally {
      if (thisVersion === requestVersionRef.current) {
        setIsLoading(false);
      }
    }
  }, [debouncedSearch, providerFilter, capabilityFilter, replicateApiKey, falApiKey, kieApiKey, wavespeedApiKey]);
```

- [ ] **Step 5.2: Typecheck + lint**

Run: `pnpm lint`

Expected: no new errors in `ModelSearchDialog.tsx`.

Run: `pnpm build` (optional, slower) — or if the project has a dedicated typecheck script, use that instead.

Expected: build succeeds.

- [ ] **Step 5.3: Manual QA — cold cache path**

```bash
pnpm dev
```

Open `http://localhost:3000`, click "All models" in the FloatingActionBar. First open (cold cache) should show a spinner briefly, then the list.

- [ ] **Step 5.4: Manual QA — warm cache with SWR**

Close the dialog. Reopen it. In the browser devtools:
- **Network tab:** expect a background `GET /api/models` request to fire.
- **Console tab:** if the response differs from cached, expect `[ModelSearch] SWR detected diff, updating ...`. If identical, no log.
- **UI:** the list renders instantly; no spinner.

- [ ] **Step 5.5: Manual QA — search-miss surfaces fresh models**

With a warm-but-old cache in localStorage, search for a model that has just been published upstream (if available — otherwise artificially age the cache by editing the `timestamp` in `localStorage` via devtools). Expect the first search to render empty-from-cache, then shortly after the SWR revalidate + server search-miss retry chain, the model appears.

- [ ] **Step 5.6: Manual QA — rapid filter switching**

Open the dialog, type quickly to change the search several times, then switch providers. Expect no stale results to leak into the UI. This verifies the `requestVersionRef` guard.

- [ ] **Step 5.7: Commit**

```bash
git add src/components/modals/ModelSearchDialog.tsx
git commit -m "feat(models): client-side stale-while-revalidate for model list"
```

---

## Task 6: Verification pass

**Files:** none modified, verification only.

- [ ] **Step 6.1: Full test suite**

Run: `pnpm test:run`

Expected: all tests pass. If anything breaks outside of `src/app/api/models/__tests__/route.test.ts`, investigate — SWR should be isolated, but a neighbor test could have assumed a specific Gemini model count.

- [ ] **Step 6.2: Lint**

Run: `pnpm lint`

Expected: no new warnings or errors introduced.

- [ ] **Step 6.3: Build**

Run: `pnpm build`

Expected: build succeeds with no type errors.

- [ ] **Step 6.4: Manual QA final checklist** (from the spec)

- [ ] Cold cache → dialog opens, list loads with spinner.
- [ ] Warm cache → dialog opens instantly, devtools Network tab shows a background `/api/models` call.
- [ ] Warm cache + SWR detects diff → UI updates in place (verify via `console.debug` log).
- [ ] Search for a known-new model with warm-but-stale cache → blocking refetch, model appears.
- [ ] Revoke `GEMINI_API_KEY` → Gemini tab still shows hardcoded models.
- [ ] Rapid filter switching during background revalidate → no stale results leak into UI.

- [ ] **Step 6.5: Create PR targeting develop**

```bash
git push -u origin feature/model-fetch-freshness
gh pr create --base develop --title "Model fetch freshness: SWR + search-miss retry + Gemini discovery" --body "$(cat <<'EOF'
## Summary
- Client-side stale-while-revalidate in `ModelSearchDialog`: cache-hit returns instantly, then a background revalidate silently updates the UI if upstream differs.
- Server-side search-miss retry in `/api/models/route.ts`: when a searched query returns zero results against a cache-hit provider, bypass cache once and retry upstream (with a 60s per-cache-key throttle).
- Server-side hybrid Gemini discovery: merges Google's `v1beta/models` response with the hardcoded `GEMINI_IMAGE_MODELS` / `GEMINI_VIDEO_MODELS` arrays; hardcoded wins on ID collision, discovery-only models surface with minimal metadata.

Spec: `docs/superpowers/specs/2026-04-14-model-fetch-freshness-design.md`

## Test plan
- [x] `pnpm test:run` passes
- [x] Cold cache: dialog loads list with spinner
- [x] Warm cache: instant render + background `/api/models` call visible in Network tab
- [x] SWR diff: `[ModelSearch] SWR detected diff, updating` appears when upstream changed
- [x] Search-miss retry: searching a new model surfaces it within seconds
- [x] Gemini discovery fallback: works with `GEMINI_API_KEY` unset
- [x] Rapid filter switching during revalidate does not leak stale results

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Done

Total commits: 5 feature commits + 1 spec commit already on branch.

Net diff:
- `src/app/api/models/route.ts`: +~140 lines (humanize, fetchGeminiModels + helpers, hybrid merge block, throttle + retry block)
- `src/components/modals/ModelSearchDialog.tsx`: ~60 lines modified (fetchModels body)
- `src/app/api/models/__tests__/route.test.ts`: +~250 lines (18 new assertions across 4 describe blocks)
