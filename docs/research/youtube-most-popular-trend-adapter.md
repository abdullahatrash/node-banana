# YouTube `mostPopular` trend-adapter research

Date: 2026-09-04  
Scope: official YouTube/Google sources only; no live API calls were made. This is implementation research, not legal advice.

## Decision summary

Do **not** connect `videos.list?chart=mostPopular` to the existing generic trend-ranking and persistence path as it stands. A metadata-only adapter is technically straightforward, but the current model (a) calculates a score from YouTube metadata/statistics plus Workspace data and (b) preserves source observations and derived digests in immutable history. YouTube's default policies prohibit creating derived metrics from API Data and require public, non-authorized API Data to be refreshed or deleted within 30 days. The separate 2026 derived-metrics/storage amendment could relax some limits only after the analytics use case is accepted. [Developer Policies, especially III.E.4](https://developers.google.com/youtube/terms/developer-policies), [additional derived-metrics policy](https://developers.google.com/youtube/terms/derived-metrics-policy)

A compliant first version should therefore be a **metadata-only, provider-ordered discovery lane**: no video/audio download, no Workspace Asset, no Blitz eligibility, no custom score, and no durable API-derived history beyond the applicable retention window. Acceptance of the amendment—or written compliance guidance from YouTube—is a blocker before enabling Node Banana's current scoring/immutable-history behavior for YouTube data.

## API contract

Call `GET https://www.googleapis.com/youtube/v3/videos` with:

- `part=snippet,statistics` for the present trend candidate. Add `contentDetails` only if duration is genuinely needed, and `status` only if the UI will embed and must inspect `embeddable`; requesting a part returns all of its child properties unless a partial-response `fields` selector is used.
- exactly one filter: `chart=mostPopular`;
- optional `regionCode`, an ISO 3166-1 alpha-2 content-region code supported by YouTube;
- optional `videoCategoryId`; `0` means no category restriction;
- `maxResults` from 1–50 (default 5), clamped from the worker's current request of 100;
- the opaque `pageToken` returned by the prior response, never parsed or synthesized.

Discover supported regions with `i18nRegions.list(part=snippet)` and valid categories per country with `videoCategories.list(part=snippet,regionCode=XX)` rather than hard-coding a universal category list. A category can be unavailable for a chart/region. [Videos: list](https://developers.google.com/youtube/v3/docs/videos/list), [most-popular implementation guide](https://developers.google.com/youtube/v3/guides/implementation/videos), [I18nRegions: list](https://developers.google.com/youtube/v3/docs/i18nRegions/list), [VideoCategories: list](https://developers.google.com/youtube/v3/docs/videoCategories/list)

The list response contains `etag`, optional `nextPageToken`/`prevPageToken`, `pageInfo`, and `items[]`. Each requested video resource can supply:

- `id`;
- `snippet.publishedAt`, `channelId`, `channelTitle`, `title`, `description`, `thumbnails`, `tags`, `categoryId`, `liveBroadcastContent`, and possibly `defaultLanguage`, `localized`, and `defaultAudioLanguage`;
- `statistics.viewCount`, `likeCount`, and `commentCount` as unsigned-long values serialized as strings (`dislikeCount` is private except to the owner; `favoriteCount` is deprecated and always `0`);
- if requested, `contentDetails.duration` and region restrictions, and `status.privacyStatus`, `license`, `embeddable`, and `madeForKids`.

Parse counters as checked non-negative integers without lossy `Number` conversion. Never manufacture a missing count as `0`; the current candidate contract requires both views and likes, so it needs optional metrics or a policy-safe rejection path. [Video resource](https://developers.google.com/youtube/v3/docs/videos)

Suggested provider mapping (subject to the blockers below):

| Candidate field | YouTube source / rule |
| --- | --- |
| `externalItemId` | `video.id` |
| `title` | exact, unmodified `snippet.title` |
| `sourceUrl` | canonical `https://www.youtube.com/watch?v={id}` |
| `sourceName` | `YouTube` with per-item/source attribution |
| `sourcePublishedAt` | `snippet.publishedAt` |
| `metricsObservedAt` | adapter fetch time |
| `metrics.views`, `metrics.likes` | exact `statistics.viewCount` / `likeCount`; do not default missing values |
| `region` | requested `regionCode` (the chart's content region, not an inferred creator/video location) |
| `rights` | `metadata_only`; no asset/media/snapshot; permitted influence only `topic`; expiry no later than 30 days after observation |
| pagination | `nextCursor=nextPageToken`; `hasMore=Boolean(nextPageToken)` |

Do not claim that `mostPopular` means “highest views.” YouTube says its selection algorithm combines multiple signals and covers trending music, movies, and gaming. Preserve the provider's returned order within one region/category request and label the chart and observation time accurately. [Most-popular implementation guide](https://developers.google.com/youtube/v3/guides/implementation/videos)

## Pagination and quota

`videos.list`, `i18nRegions.list`, and `videoCategories.list` each cost 1 quota unit per request. Every request, including an invalid one, costs at least 1 unit, and every additional results page is another request/cost. Projects have a default 10,000-unit daily allocation for the general endpoint bucket, which resets at midnight Pacific Time; actual project limits must be read from Google Cloud Console. [Videos: list](https://developers.google.com/youtube/v3/docs/videos/list), [quota calculator](https://developers.google.com/youtube/v3/determine_quota_cost)

Budget with `configured region/category sources × runs/day × pages/run`, plus region/category discovery calls and retries. At the repository minimum five-minute schedule, one page for one source is 288 units/day; the repository's 20-page job ceiling would allow 5,760 units/day for that single source. Stop on missing `nextPageToken`; do not infer page count from `pageInfo.totalResults`.

## Errors and retries

The API error body exposes HTTP `code` plus `errors[].domain`, `reason`, `message`, and parameter location. `videos.list` documents `400 videoChartNotFound` for an unsupported/unavailable chart. Global errors include invalid parameters, disabled/misconfigured projects, credential failures, daily/quota exhaustion, rate limiting, 404s, 429, and 5xx responses. [Videos: list errors](https://developers.google.com/youtube/v3/docs/videos/list), [YouTube/Google API errors](https://developers.google.com/youtube/v3/docs/core_errors)

The adapter should preserve a bounded, redacted provider reason and classify failures before the worker acts:

- permanent until configuration changes: malformed/unsupported region or category, `videoChartNotFound`, invalid key, API disabled, forbidden access;
- quota-blocked: daily/quota exhaustion—do not burn all five worker attempts immediately; resume no earlier than the known reset or operator action;
- transient: timeouts/disconnects, 429 rate limits, and 5xx—retry the idempotent GET with truncated exponential backoff and jitter, honoring `Retry-After` if present.

Google's general retry guidance recommends retrying only transient `408`, `429`, `5xx`, and connection failures, with exponential backoff plus jitter and a retry/deadline cap. The current worker retries every adapter exception under one generic code, so the adapter boundary needs typed failure semantics or the repository will retry permanent failures and obscure quota exhaustion. [Google retry strategy](https://cloud.google.com/storage/docs/retry-strategy)

## Policy constraints

### Storage, refresh, and deletion

A key-only public `mostPopular` response is **Non-Authorized Data** (inference from the policy definition and the endpoint's public-data access model). An API Client may temporarily store only limited amounts needed for its purpose, for no more than 30 calendar days; by then it must refresh or delete the data. Stored data should track current YouTube metadata/counts promptly, and the UI must show the newest available values. Historical data may be displayed only with accurate time context and still remains subject to the retention rule. [Developer Policies III.E.4](https://developers.google.com/youtube/terms/developer-policies)

If the API agreement is suspended or terminated, the Terms require deletion of API Data in the client's possession or control. User/OAuth deletion deadlines are mostly outside a key-only adapter, but any later OAuth extension must implement revocation and user-data deletion flows. [API Services Terms](https://developers.google.com/youtube/terms/api-services-terms-of-service), [Developer Policies III.D.2 and III.E.4](https://developers.google.com/youtube/terms/developer-policies)

### Derived data, aggregation, and ranking

By default an API Client must not replace YouTube data or use API Data to create new/derived data or metrics. The policy specifically forbids a score that factors in likes, views, or other API Data, and requires clear, prominent disclosure when non-YouTube information is displayed alongside YouTube API Data. The compliance guide permits simple YouTube-only arithmetic/sorting, but not mixing other sources into those metrics. [Developer Policies III.E.2 and III.E.4.8](https://developers.google.com/youtube/terms/developer-policies), [compliance guide](https://developers.google.com/youtube/terms/developer-policies-guide)

Starting June 1, 2026, a separate amendment can permit specified analytics uses—including custom scores, additive categorization/tagging, and brand-suitability planning—only after the developer applies under Analytics & Reporting and accepts the amendment. An accepted use case may store statistical and derived metrics up to 36 months, while titles, creator names, descriptions, and comment text still require 30-day refresh/deletion. This exception must not be assumed from ordinary API access. [Additional policies for derived metrics and data storage](https://developers.google.com/youtube/terms/derived-metrics-policy)

### Attribution, presentation, and legal links

- Clearly identify YouTube as the source wherever YouTube videos, channels, thumbnails, or metadata appear. In a mixed-source feed, per-item attribution may be necessary; one global label can be insufficient.
- Use the appropriate unmodified YouTube logo/icon under the Branding Guidelines. It must be clickable and link to the relevant YouTube content or the app's YouTube component. Titles/thumbnails should remain visible and unmodified; a video link should open the YouTube app when available, otherwise the system browser.
- The API Client must link to the [YouTube Terms of Service](https://www.youtube.com/t/terms) and state in its own terms that users agree to be bound by them. Its always-accessible privacy policy must disclose use of YouTube API Services, link Google's Privacy Policy, and explain API/user-data access, storage, use, processing, and sharing.

Sources: [Developer Policies III.A and III.F](https://developers.google.com/youtube/terms/developer-policies), [Branding Guidelines](https://developers.google.com/youtube/terms/branding-guidelines), [compliance guide](https://developers.google.com/youtube/terms/developer-policies-guide).

### Client identity and credentials

Do not mask the developer or API Client identity. Use only credentials assigned to its API Project; YouTube's policy requires exactly one API Project per API Client and forbids exposing credentials to third parties or embedding them in open source. Keep the API key server-side and apply both API and application restrictions appropriate to the deployment. [Developer Policies III.D.1](https://developers.google.com/youtube/terms/developer-policies), [Google Cloud API-key restrictions](https://cloud.google.com/docs/authentication/api-keys)

If the product later embeds playback, the embedded player must receive API Client identity via `HTTP Referer`; do not suppress it with `Referrer-Policy` or `window.open(..., "noreferrer")`. YouTube recommends `strict-origin-when-cross-origin`; use the documented `origin`/WebView identity alternatives where a Referer is otherwise absent. [Required Minimum Functionality: API Client Identity](https://developers.google.com/youtube/terms/required-minimum-functionality), [player parameters](https://developers.google.com/youtube/player_parameters)

### Metadata only; no download rights

Do not download, import, back up, cache, or store YouTube video/audio, enable offline playback, extract tracks, or send YouTube media bytes into Node Banana generation. YouTube permits compliant display/playback through its services, not a general reproduction/remix license. Store only the necessary IDs, URLs, API metadata/statistics, and observation/expiry metadata. If thumbnails are used, display the returned thumbnail URL unmodified and apply the same storage/refresh rules; do not ingest it as a Workspace Asset. [Developer Policies III.E.1 and III.G](https://developers.google.com/youtube/terms/developer-policies), [API Services Terms](https://developers.google.com/youtube/terms/api-services-terms-of-service), [compliance guide](https://developers.google.com/youtube/terms/developer-policies-guide)

## Repository conflict audit

| Current repository behavior | Conflict / required gate |
| --- | --- |
| [`rankTrendCandidate()`](../../src/lib/product-surfaces/trend-ranking.ts) derives `performance` from `views + likes*4`, token-matches title/tags to Brand Profile, and combines those with region/language/format/preference into a 0–10,000 score. | Direct default-policy conflict: the score uses YouTube API Data and mixes it with non-YouTube Workspace data. Bypass generic ranking/persist provider order unless the derived-metrics amendment is accepted for this exact analytics/planning use case. |
| [Product-record persistence](../../src/lib/product-surfaces/trend-ingestion-repository.ts) copies title, metrics, region, tags, evidence, score, and digests; [ingestion receipts](../../drizzle/0117_inspiration_trend_ingestion.sql) are append-only and reference immutable revisions. | No demonstrated refresh/delete path can remove all API Data and API-derived artifacts within 30 days or on termination. Append-only receipts/revisions are incompatible unless YouTube payloads and derived hashes are stored in a separately purgeable/expiring boundary. A hash/digest should not be presumed exempt. |
| [`metrics.views` and `metrics.likes`](../../src/lib/product-surfaces/trend-types.ts) are required non-negative numbers. | API counters are unsigned-long strings and fields can be unavailable. Parsing may exceed JavaScript's safe integer range, and substituting zero would misrepresent YouTube. Change the provider-neutral metric shape or reject incomplete/unsafe items. |
| The [candidate schema](../../src/lib/product-surfaces/trend-types.ts) requires `contentLanguage: ar|en`, an internal `format`, and potentially Arabic variety; the API may omit its language fields and YouTube category is a separate taxonomy. | Do not infer/overwrite a YouTube content category, dialect, or format under the default policy. These fields must become nullable/provider-neutral, be labeled as Node Banana additions under an accepted amendment, or block ingestion. Requested `regionCode` is only chart context, not content location. |
| Metadata-only rights permit topic influence and cannot become Blitz-ready without an Asset and Rights Snapshot. | This is the correct baseline. The adapter must always set `metadata_only`, `sourceAssetId/sourceMediaType/rightsSnapshot=null`, and `permittedInfluence=["topic"]`; it must never fetch media or create an Asset from YouTube. |
| The [worker](../../src/lib/product-surfaces/trend-ingestion-worker.ts) requests `limit: 100`, retries every exception, and uses one generic failure code. | Clamp API `maxResults` to 50. Add typed permanent/quota/transient outcomes before enabling production so invalid configuration is not retried as an outage. |
| A source has one stored cursor and can be scheduled every five minutes; a job can process 20 pages. | Model each region/category request as a distinct source, treat page tokens as opaque and request-specific, clear/replace stale cursors when configuration changes, and enforce a daily quota budget. |
| Mixed-source UI currently uses a generic source label/link. | Add explicit per-item YouTube attribution, legal/privacy links, unmodified metadata rules, and embedded-player identity handling before display/playback. |

## Assumptions and blockers

- **Assumption:** the first adapter uses an API key only and requests public chart data. OAuth-authorized data has additional consent/revocation/deletion duties.
- **Assumption:** no embedded player is part of initial ingestion. If playback is added, all player minimum-functionality and identity requirements apply.
- **Blocker:** obtain acceptance of the 2026 derived-metrics amendment or written YouTube compliance guidance before using the repository's custom score, Brand Profile matching, inferred tags/language/format, cross-source ranking, or long-lived derived history.
- **Blocker:** design and verify a purge/refresh mechanism that reaches current records, immutable revisions, receipts, search indexes, caches, logs, backups, and derived digests. The current append-only trigger prevents an obvious compliant purge.
- **Blocker:** decide how provider-neutral trend candidates represent absent/64-bit counters and absent language/format data without fabricating YouTube attributes.
- **Blocker:** ship required YouTube attribution and Terms/privacy disclosures before any user-facing release.
- **Operational check:** subscribe to the [YouTube API Terms revision history](https://developers.google.com/youtube/terms/revision-history); the policies and resource semantics changed in 2026 and must be rechecked before implementation.
