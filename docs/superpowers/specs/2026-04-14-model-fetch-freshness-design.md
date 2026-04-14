# Model Fetch Freshness — Design

**Date:** 2026-04-14
**Branch:** `feature/model-fetch-freshness`
**Status:** Design (pre-implementation)

## Problem

Users cannot find newly-released models in the model search dialog until caches expire. Two distinct causes:

1. **Stale cached lists** for API-backed providers (Replicate, Fal, WaveSpeed). The client caches `/api/models` responses in localStorage for 48h, and the server caches upstream responses in-memory for 1h. A user who searched yesterday sees yesterday's model list for up to 48h.
2. **Hardcoded providers** (Gemini, Kie) cannot surface new models at all without a code change. Gemini is the priority here — Google ships new image/video models frequently.

The current manual "refresh" button exists but is not discoverable and puts the burden on the user to notice staleness.

## Goals

- A user searching for a just-released model from Replicate, Fal, WaveSpeed, or Gemini should find it without manual action.
- Existing cached-list UX (instant open) stays instant.
- No change to the manual refresh button — it remains as an escape hatch.
- Kie is out of scope (no discovery API; a remote manifest was considered and deferred).

## Non-goals

- Revamp of the schema cache (`/api/models/[modelId]`). Discovered Gemini models will fall back to generic schemas — acceptable for v1.
- Remote manifest for Kie. Deferred; ops complexity not yet warranted.
- Changes to cost tracking, model registry format, or downstream node execution.

## Architecture

Three coordinated, isolated changes:

1. **Client SWR** in `ModelSearchDialog.tsx` — cache hit returns immediately, then a background revalidate updates state if the upstream returned different data.
2. **Server search-miss retry** in `/api/models/route.ts` — when a searched query returns zero results against a cached provider, transparently bypass cache for just that provider and retry once.
3. **Gemini hybrid discovery** in `/api/models/route.ts` — call Google's `v1beta/models` endpoint at request time, merge with hardcoded `GEMINI_IMAGE_MODELS` / `GEMINI_VIDEO_MODELS` (hardcoded wins on ID collision).

Each change is independent and can ship, be reverted, or tested separately.

## Change 1 — Client SWR

**File:** `src/components/modals/ModelSearchDialog.tsx`

Current `fetchModels` (lines 175–272):

```
cache hit  → setModels(cached), return
cache miss → setLoading(true) → fetch → setModels → cache
```

New flow:

```
cache hit  → setModels(cached) immediately
          → fire background revalidate (no loading state)
          → on response: if models changed, update state + localStorage
cache miss → setLoading(true) → fetch → setModels → cache  [unchanged]
```

**"Different from cached" comparison** — compute `models.length + hash of sorted model.id list`. Cheap, detects adds/removes. Equal → skip state update. Not comparing full model shape (capabilities, descriptions can vary and would churn state without material UX change).

**Race guard** — the background revalidate bumps the same `requestVersionRef` (`ModelSearchDialog.tsx:149`). If the user changes filters mid-flight, the stale response is discarded.

**Loading indicator** — no spinner during revalidate. Optional future addition: a subtle pulsing dot on the refresh icon. Deferred.

**Failure handling** — background revalidate throws → `console.warn` + keep cached data. Never surfaces as an error state.

**Interaction with `deduplicatedFetch`** — the revalidate call passes through `deduplicatedFetch`, so rapid dialog open/close with identical filters collapses to one request.

## Change 2 — Server search-miss retry

**File:** `src/app/api/models/route.ts`

Triggered in the `GET` handler, after the provider aggregation loop (current line 1147) and before the capability filter (current line 1163).

**Trigger conditions (all must be true):**

1. `searchQuery` is non-empty
2. `allModels.length === 0` before capability filtering
3. At least one provider returned with `providerResults[p].cached === true`
4. The request does NOT have `refresh=true`
5. The `(cacheKey)` has not been revalidated in the last 60 seconds (gibberish-search throttle)

**Behavior when triggered:**

- For each cache-hit provider:
  - Re-run its fetch function (`fetchReplicateModels`, `fetchFalModels`, `fetchWaveSpeedModels`) with cache bypass
  - Write the fresh result to `setCachedModels(cacheKey, fresh)`
  - Mark the cacheKey in an in-memory revalidation-throttle map (`Map<string, timestamp>`) with 60s TTL
  - Merge fresh results into `allModels`
- Proceed to capability filter + sort as normal.

**Providers NOT retried:**

- Gemini and Kie use hardcoded lists — a second read of a static array would return identical results.
- Providers that already failed this request (`providerResults[p].success === false`) — retrying a failed upstream fetch isn't the job of search-miss logic.

**Response shape:**

No changes to `ModelsSuccessResponse`. Internal only. The existing `providerResults[p].cached` field already indicates cache state.

**Cost bound:**

Per cache-key, at most one cache-bypass refetch per 60s window. If 100 users search the same gibberish query simultaneously, only one upstream call is issued.

## Change 3 — Gemini hybrid discovery

**File:** `src/app/api/models/route.ts`

**New function:** `fetchGeminiModels(apiKey: string): Promise<ProviderModel[]>`

**Endpoint:** `GET https://generativelanguage.googleapis.com/v1beta/models?key=<key>&pageSize=100`, paginated via `pageToken`. Total timeout: 5s across all pages (enforced via `AbortController` with a shared signal; on timeout, abort and return whatever pages succeeded, or `[]` if none). Discovery must not block a user-facing request for longer than this budget.

**Response filtering:** the Gemini list returns all models (text, embedding, image, video). Keep only models whose `name` (after stripping the `models/` prefix) matches one of:

- Contains `image` (→ image model)
- Matches `veo-*` or contains `video` (→ video model)

Everything else dropped.

**Capability inference from ID:**

| ID pattern | Capabilities |
|------------|--------------|
| contains `image` | `text-to-image`, `image-to-image` |
| matches `veo-*` OR contains `video` | `text-to-video`, `image-to-video` |
| other | — (skipped by the filter above) |

**Hybrid merge (inside the `includeGemini` branch, around current line 1040):**

```ts
const hardcoded = [...GEMINI_IMAGE_MODELS, ...GEMINI_VIDEO_MODELS];
const cached = getCachedModels(getCacheKey("gemini"));
const discovered = cached ?? await fetchGeminiModels(GEMINI_API_KEY).catch(err => {
  console.warn(`[Models] gemini discovery failed: ${err.message}`);
  return [];
});
if (!cached && discovered.length > 0) {
  setCachedModels(getCacheKey("gemini"), discovered);
}

const hardcodedIds = new Set(hardcoded.map(m => m.id));
const additions = discovered.filter(m => !hardcodedIds.has(m.id));
const geminiModels = [...hardcoded, ...additions];
```

**Metadata for discovered-only models:**

```ts
{
  id: "<raw model id>",          // e.g. "gemini-4-pro-image-preview"
  name: humanize(id),            // "Gemini 4 Pro Image Preview"
  description: "Newly discovered Gemini model. Metadata may be incomplete.",
  provider: "gemini",
  capabilities: [...inferred],
  // coverImage omitted
  // pricing omitted
}
```

`humanize(id)`: split on `-` and `_`, title-case each segment. Small helper colocated with the fetch function.

**API key source:**

`process.env.GEMINI_API_KEY` (already required per `CLAUDE.md`). No client-header override — discovery is server-only. Missing key → skip discovery, return hardcoded.

**Caching:**

Reuses existing `getCachedModels` / `setCachedModels` / `getCacheKey("gemini")` with the default 1h TTL. Interacts correctly with Change 2: a search-miss against Gemini alone wouldn't trigger retry (Gemini is hardcoded-list from the retry's perspective), but a search-miss against a Gemini+Replicate result would retry Replicate and rebuild the merged Gemini list on the next cache-miss.

**Failure modes:**

| Failure | Behavior |
|---------|----------|
| `GEMINI_API_KEY` missing | Hardcoded list only, no error |
| Network / HTTP 5xx | Log warning, return hardcoded list |
| 401/403 (bad key) | Log warning, return hardcoded list |
| 429 (rate limit) | Cache still serves previous discovery; if no cache, hardcoded |
| Malformed response | Log warning, return hardcoded list |

## Data flow (end-to-end)

User types "seedance-3" → dialog debounces 300ms → `fetchModels()`:

1. Check localStorage for `all:all:seedance-3`. Hit on a 3-day-old cache (48h TTL means cache-hit if <48h). Render cached list (empty because seedance-3 didn't exist 3 days ago).
2. Fire background revalidate against `/api/models?search=seedance-3`.
3. Server:
   - Checks in-memory cache for `replicate` key. Hit. Runs client-side filter for "seedance-3" on cached list. Empty.
   - Search-miss retry triggers: bypass cache, call Replicate `/v1/models` fresh. seedance-3 is in the fresh list. Cache rewritten.
   - Merged response includes seedance-3.
4. Client SWR compares new response to cached. Length + ID hash differs → update state + localStorage.
5. UI refreshes in place, user sees seedance-3 appear within ~2s of the initial empty render.

## Error handling

| Failure | User-visible effect |
|---------|--------------------|
| SWR background revalidate fails (network, timeout) | None. Cached list stays. Warning logged. |
| Server search-miss retry: all providers fail | Empty result (same as today). |
| Server search-miss retry: one provider fails, others succeed | Partial merged results shown. Failures in `errors[]`. |
| Gemini discovery fails | Hardcoded list served. Warning logged. Not visible to user. |
| Client localStorage quota exceeded during revalidate write | Caught and ignored (existing `setCachedModels` try/catch at line 39). |

## Testing

**Server (`tests/api/models/route.test.ts`):**

1. Search-miss retry triggers when: `searchQuery` non-empty, `allModels` empty, cache-hit provider exists, no `refresh=true`.
2. Search-miss retry does NOT trigger when `refresh=true` already set.
3. Search-miss retry respects the 60s throttle (second request within 60s returns empty without bypass).
4. Gemini discovery merges with hardcoded, hardcoded wins on ID collision.
5. Gemini discovery failure falls back to hardcoded list.
6. Gemini discovery with no API key returns hardcoded list.
7. Discovered-only Gemini models have expected shape (id, name via `humanize`, description, capabilities, no pricing).

**Mocks:** `vi.fn()` against `global.fetch` per existing patterns. Use fixture objects for Replicate / Fal / Google response shapes.

**Client (`ModelSearchDialog.tsx`):**

No unit tests. Rationale: no existing modal test infrastructure, and the SWR logic is straightforward enough to verify via manual QA. The comparison logic is kept dead simple (length + sorted ID hash) to reduce subtle bug risk. Add `console.debug` when SWR detects a diff so it is observable in devtools.

**Manual QA checklist:**

- [ ] Cold cache → dialog opens, list loads with spinner.
- [ ] Warm cache → dialog opens instantly, devtools Network tab shows a background `/api/models` call.
- [ ] Warm cache + SWR detects diff → UI updates in place (verify via `console.debug` log).
- [ ] Search for a known-new model with warm-but-stale cache → blocking refetch, model appears.
- [ ] Revoke `GEMINI_API_KEY` → Gemini tab still shows hardcoded models.
- [ ] Rapid filter switching during background revalidate → no stale results leak into UI.

## Risk & rollback

Each change is isolated in its own file region and can be reverted independently:

- Revert Change 1: replace `fetchModels` body with pre-SWR version.
- Revert Change 2: remove the retry block after the provider loop.
- Revert Change 3: remove `fetchGeminiModels` call, restore the direct hardcoded spread.

No data migrations, no schema changes, no breaking API contract changes.

## Open questions

None. Decisions made during brainstorming:

- Scope: API-backed providers + Gemini discovery (Kie deferred).
- Search-miss: blocking refetch, server-side, scoped to cache-hit providers.
- Freshness for existing cached lists: SWR (stale-while-revalidate).
- Gemini strategy: hybrid with hardcoded-wins-on-collision.
