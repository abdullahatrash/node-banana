# Social Feature Parity Tracker: Postiz App vs Node Banana

Last reviewed: 2026-05-24

This tracker compares the product feature surface in `/Users/neoak/projects/postiz-app` with the current Node Banana `/social` route. It is meant to stay practical: each row should help decide what to build, polish, or intentionally skip.

## Legend

- `Complete`: Node Banana has a usable implementation for this feature.
- `Partial`: Node Banana has the route, data model, or early UI, but the feature is not yet Postiz-level.
- `Missing`: No meaningful social-route implementation found.
- `Different scope`: Node Banana may not need the feature, or the feature belongs elsewhere in the product.

## Feature Matrix

| Feature area | Postiz capability | Node Banana status | Node Banana evidence | Next action |
| --- | --- | --- | --- | --- |
| Social calendar | Calendar-based post scheduling and publishing workflow. | Complete | `/social/calendar`, day/week/month/list views, drag-to-reschedule. | Continue polishing usability and edge cases. |
| Compose flow | Multi-channel post composer with scheduling and publishing. | Complete | `/social/compose`, composer store, draft/save/schedule/publish actions. | Add richer provider-specific controls. |
| Drafts and post list | Manage drafts, scheduled posts, published posts, and failures. | Complete | `/social/posts` with all/draft/scheduled/published/failed tabs. | Add bulk actions and stronger filters if needed. |
| Connected channels | Connect, list, disable, and reauth social accounts. | Complete | `/social/channels`, account APIs, OAuth callback/select-page routes. | Improve connection diagnostics and provider setup guidance. |
| Provider breadth | About 30 social/content providers. | Partial | Node Banana supports `x`, `linkedin`, `instagram`, `tiktok`, `threads`, `pinterest`, `facebook`, `youtube`, `reddit`. | Prioritize Bluesky, Mastodon, Discord, Slack, Telegram, then blog/community providers. |
| Provider adapter architecture | Provider-specific OAuth, publishing, settings, and error handling. | Complete | `src/lib/social/provider-interface.ts`, `provider-registry.ts`, provider test suites. | Keep architecture; extend platform implementations. |
| Platform previews | Rich provider-specific post previews. | Partial | Preview components exist for X, LinkedIn, Instagram, TikTok, Facebook, YouTube. | Add Reddit, Threads, Pinterest previews and improve existing preview fidelity. |
| Provider-specific compose settings | Tags, subreddit/channel/publication selection, collaborators, visibility settings, etc. | Partial | `platformSettings` exists, but UI depth is limited. | Build per-provider settings panels for existing 9 providers. |
| Media library | Upload, store, manage, and reuse media assets. | Partial | `/social/media` lists media attached to posts. | Turn media page into reusable asset library with upload, search, reuse, delete. |
| Upload/storage pipeline | Production media upload and validation. | Partial | `src/lib/social/media.ts`, post media URLs, studio asset relation. | Connect social media library to first-class assets and validation. |
| Analytics | Post/platform performance analytics. | Partial | `/social/analytics` shows post counts, published count, ops event count, status distribution. | Add platform metrics, engagement, impressions/clicks where APIs allow. |
| Events and notifications | User-visible operational events and notification preferences. | Complete | `/social/events`, notification preferences API, per-user read model. | Add filters, severity grouping, and notification delivery UX. |
| Webhooks/plugs | Create and manage outbound webhooks. | Complete | `/social/plugs`, webhook APIs, signing, delivery, replay/dead-letter internals. | Expose subscription filters and delivery logs in UI. |
| Public API | Public API surface for external automation. | Partial | Internal social APIs exist; no Postiz-style public API product surface. | Decide whether public API is in scope; if yes, design auth, docs, rate limits. |
| OAuth apps / approved apps | OAuth app and approved-app management. | Missing | No social-route equivalent found. | Only build if Node Banana needs third-party app authorization. |
| Automation / agents | Automation rules, background tasks, AI-assisted social workflows. | Partial | `/social/agents`, automation rules/tasks APIs, workflow dispatch internals. | Add rule creation/editing UI and AI creation flows. |
| AI writing assistance | Generate, rewrite, shrink, thread, categorize, and assist with posts. | Partial | Node Banana has broader AI product context, but social composer lacks Postiz-level AI controls. | Add AI actions directly inside compose: rewrite, shorten, thread, platform adapt. |
| Background publishing | Durable publishing through background workers/workflows. | Complete | `workflows/social-publish.ts`, internal dispatch, recovery, sweep, reconcile routes. | Monitor production behavior; add observability UI. |
| Retry and failure handling | Retry, reauth handling, disabled accounts, failed posts. | Complete | Provider error classification, token refresh dispatch, events, failed status. | Make failure remediation more user-friendly. |
| Token refresh durability | Refresh tokens with concurrency safety. | Complete | Token refresh lease model and dispatch route. | Add UI indicators for refresh/reauth history. |
| Post chains / delayed children | Thread/chain orchestration and delayed child posts. | Partial | Schema has `rootPostId`, `parentPostId`, `delaySeconds`, `position`; backend parity docs mark orchestration complete. | Add composer UI for threads/chains. |
| Repeat automation | Repeating automation rules and task queue. | Partial | `social_automation_rules`, `social_automation_tasks`, agents page. | Add rule builder UX and templates. |
| Billing | Stripe billing, subscriptions, lifetime billing. | Different scope | Node Banana social route has no billing page. | Keep out unless social hub becomes separately monetized. |
| Teams / organizations | Team management and collaboration around social scheduling. | Partial | Node Banana is workspace-scoped; no Postiz-level social collaboration UX. | Add roles, approvals, comments if collaborative scheduling is needed. |
| Admin tools | Admin pages and operational error views. | Partial | Internal ops snapshot route exists; no full social admin UI. | Add admin/ops dashboard if support workflows need it. |
| Browser extension | Extension/modal flow. | Missing | No social extension app found in Node Banana. | Skip unless capture-from-web is required. |
| SDK / external clients | SDK and public integration packages. | Missing | No social SDK found. | Defer until public API exists. |

## Provider Coverage

### Node Banana Providers

- X
- LinkedIn
- Instagram
- TikTok
- Threads
- Pinterest
- Facebook
- YouTube
- Reddit

### Postiz Providers Observed

- Bluesky
- Dev.to
- Discord
- Dribbble
- Facebook
- Google Business Profile
- Hashnode
- Instagram
- Kick
- Lemmy
- LinkedIn
- Listmonk
- Mastodon
- Medium
- MeWe
- Moltbook
- Nostr
- Pinterest
- Reddit
- Skool
- Slack
- Telegram
- Threads
- TikTok
- Twitch
- VK
- Warpcast/Farcaster
- Whop
- WordPress
- X
- YouTube

## Recommended Parity Roadmap

### Phase 1: Deepen Existing Core

- Add the first Publishing Settings vertical slice for YouTube, TikTok, and Reddit.
- Start by implementing `src/lib/social/publishing-settings.ts` with registry definitions and unit tests for defaults, normalization, and publish validation.
- Use the first slice to prove the registry, per-Channel settings panels, Safe Defaults, Publish Validation, and persistence into per-Channel Publishing Settings.
- Treat Publishing Settings as functional, not decorative: first-slice settings must be consumed by provider publish calls where the platform supports them.
- Expand provider-specific composer settings to the remaining current providers after the first slice is stable.
- Expand previews for Reddit, Threads, and Pinterest.
- Add thread/chain creation UI in Compose.
- Expose webhook delivery logs, dead letters, replay, and subscription filters in `/social/plugs`.

### Phase 2: Productize Media and Analytics

- Convert `/social/media` from attached-media gallery into reusable asset library.
- Connect social media assets to existing Node Banana studio assets.
- Add platform analytics where provider APIs support it.
- Add analytics filters by account, platform, time range, and post status.

### Phase 3: AI Social Workflows

- Add AI rewrite, shorten, expand, and platform-adapt actions in Compose.
- Add AI thread generation with editable child posts.
- Add automation rule creation/editing UI in `/social/agents`.
- Add automation templates for "post after generation", "repeat campaign", and "webhook-triggered post".

### Phase 4: Provider Expansion

- Add Bluesky and Mastodon first because they align with open social publishing.
- Add Discord, Slack, and Telegram for community distribution.
- Add Medium, Hashnode, Dev.to, and WordPress for long-form publishing.
- Add provider-specific settings and previews as each provider lands.

## Notes

- Node Banana already has stronger workflow/editor context than Postiz. The most valuable differentiation is not cloning every Postiz feature, but connecting social scheduling to Node Banana's generation pipelines and assets.
- Postiz is still useful as a parity benchmark for social scheduling expectations: provider breadth, composer polish, media reuse, analytics, and automation UX.
