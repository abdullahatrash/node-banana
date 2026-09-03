# Fastlane Dashboard Parity Decision Map

Status: under design grilling; full-parity destination accepted
Captured: 2026-09-03
Scope: authenticated `app.usefastlane.ai` product dashboard compared with the current Node Banana/Tasmeemai working tree

## Evidence and notation

- **Observed (O):** verified in the authenticated Fastlane UI at a desktop viewport (about 1424×768) and at 390×844, or verified in this repository.
- **Inference (I):** probable data, API, or job behavior suggested by the UI; it is not treated as a copied contract.
- The inspected Fastlane workspace was an empty free-trial workspace. Paid Inspiration content, populated libraries/calendars/analytics, completed Influencers, later Automation steps, and publishing result states remain partly unknown.
- The sample workspace name, brand content, account identity, referral code, and generated draft identifier are deliberately omitted.
- Parity values are `existing`, `partial`, `missing`, `intentionally adapted`, or `unknown`.
- **Full-parity mandate:** every observed authenticated Fastlane capability, supporting workflow, commercial/support surface, and meaningful empty, populated, loading, failure, gated, and responsive state is part of the committed destination. Delivery slices sequence this fixed scope; they do not define an MVP.
- Product-language decisions in `CONTEXT.md` and ADRs 0001–0015 outrank Fastlane terminology. In particular: use **Workspace**, **Brand Profile**, **Channel**, **Platform**, **Artifact**, **Publishing Plan**, **Publishing Approval**, **Publishing Delivery**, and **Content Operations Runtime**.
- Fastlane is a product-behavior reference, not an architecture, identity, or copy template. Tasmeemai keeps the shared Application Capability boundary (ADR 0013), approval-first publishing (ADR 0010), normalized Publishing Settings, safe defaults, and its existing deeper capabilities. It adds Managed Provider Execution alongside BYOK under ADR 0015.

## #1: What information architecture and shell should Tasmeemai adopt?

Blocked by: none
Type: Research

### Question

How should the authenticated product be organized before feature-parity work begins?

### Answer

**Fastlane surface — global shell, every authenticated route.**

- **O route/nav:** persistent desktop sidebar with Workspace switcher, collapse control, primary links (`/home`, `/blitz`, `/inspiration`, `/automations`, `/ai-studio`, `/influencers`, `/content`, `/library`, `/calendar`, `/analytics`, `/warmed-accounts`), then commercial/support links (`/refer-and-earn`, `/brand`, `/guide`, `/feedback`, Discord, Settings). A thin top bar shows trial/plan state and Upgrade. A floating Copilot is globally available.
- **O layout/state/interactions:** light neutral canvas; about 256 px sidebar; active rows; workspace avatar/name; account menu exposes workspace creation allowance, Upgrade, Settings, and Sign out. Settings is an overlay with a vertical section list. At 390 px the sidebar becomes a hamburger drawer, the centered Fastlane wordmark remains, and settings becomes a near-full-screen sheet with a section dropdown. Inspiration and Refer & Earn were absent from the mobile drawer.
- **I behavior:** shell data is account + current Workspace + entitlements + plan/credit counters; navigation is client-side; feature gates are enforced server-side as well as visually.
- **Node Banana now:** authenticated product is split across `SimpleStudioLayout`, `SocialLayout`, standalone `/blitz`, `/studio/*`, `/agents`, and the editor microfrontend. `AppSwitcher` jumps among pillars. `/dashboard` is classified as a product path but has no page. Both Studio and Social use the same shadcn sidebar primitives, but navigation, headers, copy, and mobile behavior are duplicated and largely English-only.
- **Parity:** `partial`.
- **Arabic/English:** build one direction-aware product shell. Use logical CSS (`start/end`, `ms/me`, `border-s/e`) and mirror drawer, chevrons, progress direction, and breadcrumb flow. Keep brand marks, media controls, numeric identifiers, URLs, handles, and code LTR where appropriate. Arabic is the default Interface Language; English must produce a native LTR layout, not a mirrored Arabic screenshot.
- **Dependencies/risks:** route compatibility, editor microfrontend boundary, workspace membership/selection, existing onboarding guards, and preserving deep links. Risk: a visual shell rewrite could accidentally fork business logic or hide operational Cockpit routes.
- **Acceptance:** `/dashboard` is the authenticated landing page after onboarding; one shell reaches existing creation, media, social, brand, agent, and operational routes; desktop collapse and 390 px drawer are keyboard accessible; Arabic and English visual tests cover both directions; route authorization remains server-enforced.

Decision: implement a unified Tasmeemai shell first, but initially link through to existing feature routes. Do not rename domain resources or duplicate their APIs to match Fastlane labels.

## #2: What belongs on the authenticated home dashboard?

Blocked by: #1
Type: Research

### Question

What should replace Fastlane `/home` for an Arabic-first MENA creator?

### Answer

**Fastlane surface — `/home`, first primary nav item.**

- **O UI:** centered promise (“Lets get your product seen.”), a 0/4 Quickstart card (“Swipe content in Blitz”, “Connect your account”, “Upload a demo video”, “Make your first post”), progress rule, Continue setup CTA, Changelog link, Trending Content empty state, and a long categorized FAQ. A release-update toast can overlay the page.
- **O responsive:** desktop centers a narrow activation card in open space; mobile makes the card almost full width, keeps the four task rows touch-sized, and stacks Changelog and later sections.
- **I behavior:** completion is derived from Workspace activity (reviewed/generated content, Channel connections, uploaded assets, Posts) rather than manually checked flags; trending content is Workspace/brand-filtered; changelog/update dismissal is per user.
- **Node Banana now:** onboarding is resumable and durable, creates a Workspace and reviewed Brand Profile, and hands off to `/blitz`. `/blitz` shows one activation Artifact with provenance and links to copy/image generation. There is no authenticated `/dashboard`, readiness summary, aggregate activity, or contextual next-best action.
- **Parity:** `partial`.
- **Arabic/English:** localize task order and copy; preserve independent Interface Language and Content Language; format dates, counts, and time zones by locale. Arabic copy should be authored, not mechanically translated. FAQ topics should cover MENA-relevant Channel rules and safe publishing, not Fastlane’s account-warming advice verbatim.
- **Dependencies/risks:** needs read-only Workspace summary queries across onboarding, assets, Channels, Posts, Runs, Approvals, and Deliveries. Risk: inventing another mutable checklist instead of deriving state.
- **Acceptance:** dashboard renders useful empty, partial, ready, loading, and degraded states from canonical resources; every CTA lands on an existing route; no dashboard-only mutation path is introduced; RTL/LTR and narrow-screen snapshots pass.

Decision: the dashboard is a Workspace command center: activation progress, work needing review, upcoming publishing, recent Artifacts, and one recommended next action. FAQ/changelog are secondary.

## #3: How should discovery, Inspiration, and Blitz map to Tasmeemai?

Blocked by: #1, #2
Type: Research

### Question

Which parts of Fastlane’s trend-to-approval loop should be adopted?

### Answer

**Fastlane surface A — `/inspiration`, primary nav after Blitz.**

- **O UI:** paid gate headed “Inspiration Library”; describes a daily searchable viral short-form feed filtered by niche, topic, and format, with an Upgrade CTA. The authenticated free-trial view did not reveal cards, filters, detail screens, or remix actions.
- **I behavior:** background ingestion/enrichment of trend items, engagement snapshots, niche/format tagging, search, entitlements, and a remix handoff that preserves source attribution.
- **Node Banana:** no trend corpus. Prompt Library is saved/public prompt discovery, not market evidence.
- **Parity:** `missing` for trends; `unknown` for Fastlane’s paid result/detail interactions.

**Fastlane surface B — `/blitz`, primary nav.**

- **O UI:** swipe/review workspace with “Remixed From” reference media and engagement counts, one centered generated vertical card, format chip, “Why This Content?”, mute, Reject, Edit, Approve, Smart positioning, and Configure. Mobile hides the side-by-side source panel behind “View Original” and keeps the card/actions centered. Empty/loading states were not observed.
- **I behavior:** a Workspace queue is generated from Brand context + trend/template sources; reject/approve advances a queue; approval likely creates saved content or a draft Post; configuration controls content mix and queue generation; provenance connects source and derivative.
- **Node Banana:** `/blitz` is a responsive, bilingual first-value page for one onboarding Activation Artifact. It has rationale, suggested formats, Brand Profile provenance, and creation CTAs, but no queue, source trend, edit, accept/reject, or publishing handoff.
- **Parity:** `partial`.
- **Arabic/English:** horizontal swipe semantics must follow explicit Reject/Approve meaning rather than assuming physical left/right under RTL. Overlay copy must handle Arabic shaping and mixed text. Trend metadata, sources, and rights must remain visible. Video controls stay spatially consistent.
- **Dependencies/risks:** Brand Profile, immutable Artifacts/lineage, trend-source rights, reusable format definitions, generation Runs, and draft Publishing Plans. Major risks are copyright, deceptive copying, and treating a UI approval as durable Publishing Approval.
- **Acceptance:** every card shows why it fits the Brand Profile and its source/provenance; Reject and content acceptance are idempotent; accepting never publishes; editing produces explicit Artifact/revision lineage; the queue resumes across devices; RTL gestures and keyboard buttons agree.

Decision: build a provenance-first “Ideas to review” queue after the content format and library spines exist. Do not ship an untraceable viral-content scraper or copy Fastlane’s swipe gestures before explicit action semantics are proven.

## #4: How should campaign Automations be represented?

Blocked by: #1, #5, #7, #8
Type: Research

### Question

Can Fastlane’s batch campaign workflow reuse the existing runtime instead of creating another job system?

### Answer

**Fastlane surface — `/automations`, plus `/automations/{id}/edit`.**

- **O list:** header, description (“Batch-generate content and schedule it straight into your calendar”), quota (`0 / 1 used`), New automation, and first-use empty state.
- **O builder step 1:** a 10-step progress indicator; optional campaign name; four-part content mix (Slideshow, Wall of text, Green screen, Video hook) constrained to 100%; a 50% Remix ratio slider; Continue. Later steps and launched states were not inspected.
- **I behavior:** the initial click allocates a draft campaign identity; later steps likely select Channels, schedule/cadence, media/configuration, review, and launch. Launch probably fans out background generation and scheduled publishing with quota/credit admission.
- **Node Banana:** `/social/agents` exposes legacy automation rules/tasks and notification control. The Content Operations Runtime has canonical Automation/Revisions/Occurrences, outbox intents, execution leases, capability contracts, budgets/quotas, Runs, Artifacts, Publishing Plans, Approvals, and Deliveries. There is no creator-oriented campaign builder.
- **Parity:** `partial` in backend capability, `missing` in creator workflow.
- **Arabic/English:** use a direction-neutral stepper; localize format names and explanatory copy; cadence uses Workspace IANA timezone and locale-aware dates. Percent controls must remain mathematically left-to-right even when labels are RTL.
- **Dependencies/risks:** format catalog, generation workflows, Channels, calendar capacity, admission preview, budgets/quotas, approval policy, durable occurrence inspection. Risk: duplicating `socialAutomation*` and runtime Automation models or implying background work is complete at acceptance.
- **Acceptance:** draft edits create immutable Automation Revisions; launch returns Durable Acceptance and exposes progress via canonical resources/events; content mix totals 100%; admission failures do not partially launch; generated work lands in review by default; resuming and cancellation are idempotent.

Decision: build the UI on the runtime Automation and Application Capability boundary; legacy social automation is a migration source, not the new campaign domain.

## #5: Which manual creation surfaces should be unified?

Blocked by: #1, #10
Type: Research

### Question

How should Fastlane AI Studio and Content map onto existing generation infrastructure?

### Answer

**Fastlane surface A — `/ai-studio`.**

- **O Images:** Images/Videos segmented view, help and credit controls, prompt, composition upload/media-bank picker, model, aspect ratio, 720p/1080p, count 1/4, template, generation cost and ETA, results empty state.
- **O Videos:** image-to-video prompt, animation model/template/duration, insufficient-credit state; Talking Head UGC mode adds script generation, language (including Arabic), duration, captions, and word-count guidance.
- **I behavior:** generation requests are queued; credits are checked/reserved; uploads refer to a Workspace media bank; result progress is observed and completed media is persisted.
- **Node Banana:** `/simple-studio/images`, `/videos`, `/copy` provide model discovery, multi-provider/BYOK generation, batch presets, reference media, prompt enhancement, Arabic/English dialogue and copy output, duration/aspect controls, progress/cancel/retry, recent results, and best-effort Workspace asset persistence. `/api/generate` uses provider adapters and queue polling; `/api/llm` supports Google/OpenAI/Anthropic. The surface is form-first and split across routes.
- **Parity:** `existing` for core image/video/copy generation; `partial` for unified canvas, templates, talking-head configuration, persistent job observation, and productized usage feedback.

**Fastlane surface B — `/content` redirects to `/content/talking-head-ugc`.**

- **O UI:** two-column desktop editor (stacked controls left, 9:16 preview right); mobile stacks the preview below controls. A format picker exposes Slideshow, Wall of Text, Video Hook & Demo, Speaking Hook & Demo, Talking Head UGC, Green Screen Meme, Talking Head Green Screen, Product Spokesperson, Green Screen Mobile with App, Claymation, Character Swap, and Custom upload. Talking Head controls include 4–60s duration, 22 languages including Arabic, Speaker/Scene, caption overlay/styles, script generator, preview, cost, and Generate.
- **I behavior:** each format is a versioned recipe with required inputs, preview schema, model chain, cost ceiling, and Artifact outputs; media-changing edits create a new saved item while text/style edits may update an existing content draft.
- **Node Banana:** generic generation plus a separate `/editor/*` microfrontend. No product-level format registry or guided multi-step content recipes.
- **Parity:** `partial`.
- **Arabic/English:** make format definitions declare supported Content Languages, typography/caption safety, direction, and text limits. Arabic captions require shaping, bidi isolation, safe line breaking, and rendered-video tests. Editor controls mirror; the video canvas itself does not blindly mirror.
- **Dependencies/risks:** model capabilities/schemas, Content Workflow Revisions, Run admission preview, media assets, editor handoff, usage evidence, and template licensing. Risk: hardcoding formats directly into React or pretending estimates/unknown pricing are credits.
- **Acceptance:** one format registry drives launcher, validation, workflow input, cost/admission preview, progress, result lineage, and editor handoff; core generic Studio stays usable; failed/outcome-unknown Runs remain inspectable; Arabic caption render fixtures pass.

Decision: retain Simple Studio as the low-level generator and layer a format-driven Content launcher over versioned Workflows. Do not replace provider/model discovery with Fastlane-branded model labels.

## #6: How should persistent AI Influencers reach full parity?

Blocked by: #5, #7, #10
Type: Research

### Question

What complete Tasmeemai capability should correspond to Fastlane-style reusable AI characters?

### Answer

**Fastlane surface — `/influencers`.**

- **O UI:** heading and help, credit balance/purchase, New influencer, first-use empty state, and three-step onboarding: create a persona and train a persistent character; generate images then videos from an image; configure social connections/content sets that feed Blitz.
- **I behavior:** character records own traits, training source/consent, provider training Runs, status and reusable model reference; generated assets retain character lineage; content sets join characters/media to Blitz configuration.
- **Node Banana:** no character/persona/training resource. Reference images and image-to-video are ephemeral inputs; Artifacts and provider Workflows provide the foundation for the committed implementation.
- **Parity:** `missing`.
- **Arabic/English:** persona identity and generated speech language are separate; Arabic voice/dialect, consent, gender/cultural representation, disclosure, and pronunciation need explicit controls; names/handles use bidi isolation.
- **Dependencies/risks:** consent and likeness policy, provider/model evaluation, immutable training provenance, credential/budget controls, disclosure metadata, and safe deletion/retention. High abuse, biometric, IP, and cost risk.
- **Acceptance:** no training without explicit rights/consent evidence; training is a durable Run with failure/retry states; character use is Workspace-scoped; generated media carries lineage/disclosure; Arabic dialect and caption tests are defined before launch.

Decision: persistent AI Influencers are in the full-parity destination. Implement the complete persona, consent, training, generation, connection/content-set, Blitz handoff, lifecycle, and safe-deletion experience as a distinct bounded product slice after its Workflow and Artifact prerequisites—not as an optional someday feature or a field added to the existing image form.

## #7: What is the canonical library and media model?

Blocked by: #1
Type: Research

### Question

How can Fastlane’s Library be matched without creating more asset silos?

### Answer

**Fastlane surface — `/library`.**

- **O tabs:** My Posts (type menu, Refresh Metrics, All/Scheduled/Drafts/Published/Needs attention); My Content (type/status filters and item count); My Media Bank (sets, New set, drag/drop/click upload for JPG/PNG/WebP/MP4/MOV, search, image/video/category filters, Upload and Select). All inspected tabs were empty.
- **I behavior:** Posts join publishing state + refreshed platform metrics; Content represents editable/saved creations; Media Bank stores raw reusable files and named/category sets; selection is reusable from generators, formats, and publishing.
- **Node Banana:** `/simple-studio/library` lists Workspace assets by photo/video/copy; `/social/media` derives media from Posts; `/social/posts` filters post status; Compose Media Pool browses/uploads canonical Workspace assets; Prompt Library is separate. Asset APIs support presign/finalize, quotas, soft deletion, downloads, project scoping, and cleanup. The UI exposes overlapping libraries.
- **Parity:** `partial`, with stronger underlying storage controls than the visible product shell suggests.
- **Arabic/English:** filters and tabs mirror naturally; media metadata uses `dir=auto`; search must normalize Arabic letter variants/diacritics without corrupting exact filenames; dates/sizes localize; media order should not reverse unexpectedly.
- **Dependencies/risks:** choose Artifact vs legacy `assets` authority per item type; migration/read model; signed delivery; storage quotas; lineage; post metrics. Risk: copying Fastlane’s three nouns while preserving three different databases.
- **Acceptance:** one `/library` read model presents Posts, created Artifacts/content, and uploaded media without duplicating bytes; every card identifies origin, state, and reusable actions; filters are URL-addressable; upload and quota failures are recoverable; social Compose and Studio select the same canonical item.

Decision: consolidate the user experience around the existing Workspace media spine, while progressively projecting immutable runtime Artifacts. Keep Posts as publishing resources, not files.

## #8: How should Calendar, Channels, Compose, and publishing converge?

Blocked by: #1, #7
Type: Research

### Question

Which Fastlane scheduling affordances improve the already-built Social Hub?

### Answer

**Fastlane surface — `/calendar`; Settings → Integrations.**

- **O Calendar:** month navigation, current month heading, four status counters (the empty view did not expose labels semantically), failed/paused count, Sunday-first 7-column month grid, today highlight, and floating Copilot. Mobile compresses weekday labels to initials and keeps the grid horizontally fitted.
- **O Integrations:** connection allowance, TikTok/YouTube/LinkedIn/Instagram cards with status and Connect; browser-account guidance; LinkedIn 60-day reconnection notice; Website Analytics enablement. Fastlane FAQ documents direct/inbox and per-platform capacity behavior, but implementation was not exercised.
- **I behavior:** scheduled items are Workspace/timezone-scoped; counters derive from publish states; background delivery, retry, reauth, and metric refresh jobs update the calendar; provider limits are admission checks.
- **Node Banana:** `/social/calendar` already has day/week/month/list views, date navigation, Today, channel filters, loading/no-Channel states, post cards/details, and Compose links. `/social/compose` selects Channels, applies normalized per-Channel Publishing Settings and validation, attaches Workspace media, previews eight Platforms, saves drafts, schedules, and publishes. `/social/channels` manages provider connections. Canonical runtime Approvals/Deliveries and dedicated operational screens exist alongside the legacy social Post path.
- **Parity:** `existing` for creator scheduling basics; `partial` for a unified shell, friendly status summary, canonical Approval/Delivery migration, metrics, and Website Analytics.
- **Arabic/English:** Workspace week start must be configurable (not copied as Sunday globally); grid direction, month arrows, date numerals, timezone, and day names localize. Mixed handles stay isolated. Publish buttons must use explicit words, never direction-only icons. Arabic platform preview must respect real Platform bidi behavior.
- **Dependencies/risks:** migrate UI commands behind canonical capabilities; Channel readiness/reauth; Workspace timezone/region; delivery event projections; safe defaults and approval policy. Risk: retaining two publish authorities or equating “scheduled” UI state with provider acceptance.
- **Acceptance:** month/week/day/list all read one canonical projection; per-target readiness and failures are visible; schedule/publish revalidate server-side; acceptance does not claim completion; retry/reconciliation cannot duplicate provider effects; mobile calendar remains readable in both directions.

Decision: preserve the Social Hub’s deeper multi-Platform behavior and make it the publishing engine under the unified dashboard. Fastlane’s simpler calendar is a presentation reference only.

## #9: What analytics feedback loop is required?

Blocked by: #7, #8
Type: Research

### Question

What is the minimum useful parity for performance reporting?

### Answer

**Fastlane surface — `/analytics`.**

- **O UI:** 7 days/30 days/Quarter range controls; KPI cards for views, likes, comments, Posts, and Website Views; social-traffic-versus-Posts chart with a correlation-not-causation disclaimer; cumulative and per-day charts switchable among views/likes/comments/posts/website; account, Platform, and content-type sections; views distribution modes (absolute, Platform, content type, inbox vs direct). Empty states were observed.
- **O related:** Library has manual Refresh Metrics; Settings can enable a lightweight Website Analytics script.
- **I behavior:** periodic and on-demand platform metric ingestion, time-series snapshots, post/account/content-type dimensions, site event collection and attribution safeguards. Refresh requires rate limiting and last-updated evidence.
- **Node Banana:** `/social/analytics` shows total/published Post counts, recent ops-event count, and status distribution only. Runtime usage/cost/observability Cockpits are operational evidence, not audience performance. ADR 0009 requires analytics to be readable through the Agent Interface; `CONTEXT.md` names GEO Citation Tracking as a north-star reporting metric.
- **Parity:** `partial`.
- **Arabic/English:** charts mirror labels/tooltips but keep time increasing consistently; Arabic numerals and compact units are locale-aware; Platform/handle strings use bidi isolation; support local timezone and UTC evidence. Reporting copy must distinguish correlation, attribution, estimated, and unknown values.
- **Dependencies/risks:** Channel metric adapters, immutable snapshots, normalized metric registry, content taxonomy, website event privacy/consent, Agent capabilities, and GEO tracking. Risks: provider API gaps, retroactive metric changes, false attribution, and mixing runtime cost telemetry with marketing outcomes.
- **Acceptance:** every metric shows source, range, last refresh, and unknown/unavailable states; aggregates reconcile to item/account projections; refresh is bounded/idempotent; Analytics and Agent Interface use the same query capabilities; Arabic/LTR chart tests cover zero, sparse, and mixed-Platform data.

Decision: first ship post/account performance and freshness; add Website Analytics only with explicit privacy design; keep GEO Citation Tracking as a separate, first-class reporting dimension.

## #10: How should Brand and Workspace setup evolve after onboarding?

Blocked by: #1
Type: Research

### Question

How much of Fastlane `/brand` should become a post-onboarding Brand Profile center?

### Answer

**Fastlane surface — `/brand`; workspace switcher and Settings → Workspaces/Language/Preferences.**

- **O Brand UI:** logo/name/domain/locale header; Website Brand source with Change and Refresh; editable Content Angles; Tone & Voice Do’s/Don’ts (10 each); Identity & Product, Purpose & Positioning, Market & Competition sections with Edit; weighted customer segments, competitor list, and last-updated date.
- **O Workspace/settings:** current Workspace, delete control, create allowance; timezone and region selectors; generated Content Language selector whose change refreshes Blitz immediately. Interface chrome stayed English.
- **I behavior:** Website refresh creates analysis work and a reviewed profile revision; Workspace selection scopes all product data; language/timezone/region are Workspace settings; destructive Workspace deletion has a confirmation/recovery policy.
- **Node Banana:** onboarding already captures identity/logo, Website or manual Brand Source, company stage, role, business classification, goals, attribution, Interface Language and Content Language. It durably extracts sources, runs analysis, creates evidence-backed versioned Brand Profiles, allows review/correction, requires explicit acceptance, and produces an Activation Artifact. The schema is richer than Fastlane (offering, audiences, problems, benefits, differentiators, mission, positioning, owned space, voice, prohibited claims/topics, competitors, angles, uncertainties, and evidence). There is no post-onboarding Brand Profile route or unified Workspace switcher/settings UI.
- **Parity:** `existing` for onboarding/profile domain; `partial` for ongoing management and multi-Workspace UX.
- **Arabic/English:** Interface Language and Content Language remain independent. Brand fields use `dir=auto`; Website URLs remain LTR; audience weights and numbers remain unambiguous; regional defaults include MENA timezones/locales without assuming Arabic implies one country.
- **Dependencies/risks:** Brand Profile revision/acceptance commands, source refresh and evidence diff, active Workspace server state, member roles, timezone/region fields. Risk: an in-place edit erases reviewed provenance or a language change silently regenerates/deletes queued work.
- **Acceptance:** `/brand` reads the accepted revision, compares source refresh proposals, and creates a new reviewable revision; old Artifacts retain their pinned profile reference; switching Workspace invalidates scoped caches; Interface/Content language changes are explicit and reversible; destructive actions require confirmation and recovery details.

Decision: expose the existing Brand Profile as a first-class center; do not flatten it into Fastlane’s unversioned-looking sections.

## #11: Which secondary settings and commercial surfaces need parity?

Blocked by: #1, #7, #8, #10
Type: Research

### Question

Which authenticated secondary surfaces are product requirements, and which should be intentionally different?

### Answer

| Fastlane route/surface (placement) | Observed UI and inferred behavior | Node Banana/Tasmeemai mapping | Parity; locale; dependencies and acceptance |
|---|---|---|---|
| Settings → Account (sidebar button; overlay) | **O:** profile/security tabs, email identities, connected login accounts, update profile, add email, delete account, sign out. **I:** identity-provider and account-lifecycle APIs. | Better Auth sign-in/up/verification/session exists; no consolidated account settings. | `partial`; bilingual security copy and correct destructive confirmations; depends on Better Auth account APIs; accept with reauthentication and audit coverage. |
| Settings → Billing | **O:** “Billing & Subscription” shell; detailed plan state did not render in the inspected trial. **I:** subscription/customer portal and entitlements. | No product billing center. Runtime BYOK spend evidence is deliberately not a subscription invoice; ADR 0015 commits a separate managed-execution commercial boundary. | `missing` and committed; currencies, tax, invoices, entitlements, payment failure, cancellation, and portal copy must localize without conflating managed charges with External Provider Spend. |
| Settings → AI Credits | **O:** balance, Buy more, monthly reset vs non-expiring add-on credits, recent ledger activity. **I:** credit ledger, reservation, settlement. | Runtime Usage Ledger, Pricing Snapshots, budgets, quotas, and `/studio/usage|budgets|quotas` support evidence; ADR 0015 adds Managed Provider Execution alongside BYOK. | `missing` for managed credits and committed; define auditable balances, purchase, reservation, settlement, refund, expiry, and insufficient-balance states while preserving unknown-not-zero and explicit execution-mode language. |
| Settings → Storage | **O:** used/limit progress and Upgrade. **I:** Workspace storage aggregation. | Asset storage limits, upload admission, cleanup, and Quota Cockpit exist. | `partial`; localized byte units; expose canonical quota and safe cleanup, not a fake plan counter. |
| Settings → Integrations | **O:** four social cards, connection allowance, status/help; Website Analytics enable. | `/social/channels`, provider registry/adapters, OAuth/App Password flows, readiness/reauth. Supports more Platforms. | `existing` core, `partial` presentation; say **Channels**, not integrations, for connected destinations; retain provider-specific safe defaults. |
| Settings → Demo Videos | **O:** MP4/MOV upload, 100 MB and 30s limits; videos feed hook formats. **I:** dedicated reusable media collection. | Workspace asset upload and Compose Media Pool; no “demo” semantic set. | `partial`; implement as a tagged/set view over assets after #7; validate duration/type server-side. |
| Settings → Remix | **O:** up to 50 slideshow themes; curated and user Media Bank sets; remove/add. **I:** ordered configuration references licensed sets. | No trend-remix/theme configuration or media sets. | `missing`; depends on #3/#7; Arabic visual/cultural curation and licensing required. |
| Settings → Preferences | **O:** timezone and region selectors, including MENA entries. **I:** Workspace scheduling defaults. | Browser-local scheduling; onboarding stores locale/content language, but no Workspace timezone/region UI. | `missing`; use IANA zones and locale-aware week start; must change projections, not historical instants. |
| Settings → Privacy | **O:** X Ads attribution toggle/status and irreversibility warning for already-sent events. | No marketing attribution control. | `missing`, lower priority; consent, retention, event deletion, and regional privacy review required before analytics script. |
| Settings → Language | **O:** generated Content Language only; Arabic is one option; UI remains English. | Arabic-first Interface Language cookie plus Workspace Content Language from onboarding. | `partial` and strategically stronger; add post-onboarding edits while retaining the two concepts and full RTL shell. |
| Settings → Notifications | **O:** email master switch, lead/activity/failed-post/disclosure-review digests. | social notification preferences, events/read state, automation task/rule UI, digest/internal dispatch routes. | `partial`; bilingual templates, per-user vs Workspace scope, quiet hours/timezone, and unsubscribe evidence. |
| Settings → API | **O:** docs, downloadable agent skill, paid gate for API keys. | `/social/settings` API tokens/provider keys; `/agents` pairing and authority; `/api/v1/*`, `/api/mcp`, CLI/MCP capability registry and parity contracts. | `existing` and deeper, but fragmented; consolidate without bypassing Principal/Workspace resolution or capability authorization. |
| Global Copilot dialog | **O:** floating launcher, new conversation, history, platform-advice prompt; mobile dialog fills the viewport. Action tools were not observed. **I:** persisted conversations and contextual product help. | `/social/copilot` operates on persisted draft Posts through transport-agnostic, approval-gated tools. | `partial`, intentionally action-scoped; global advice may be added, but publishing remains explicit and capability-backed. |
| `/guide` (sidebar) | **O:** video tutorial buttons for Blitz, manual creation, formats, Calendar/Library/Brand/Feedback, Influencers. | Onboarding education only; no guide center. | `missing` and committed; localize captions/transcripts, keep docs versioned with routes, cover every parity feature, and test every CTA. |
| `/feedback`, `/roadmap`, `/changelog` (sidebar/links) | **O:** roadmap/changelog links and categorized feedback form with up to 10 attachments/16 MB; release toast links to changelog. | No equivalent product UI. | `missing` and committed; needs privacy-safe attachment storage, a support workflow, localized release communications, and complete submission/error states. |
| `/refer-and-earn` (sidebar) | **O:** referral link/QR, embedded affiliate dashboard, clicks/leads/sales/rewards/payment settings. | No referral program. | `missing` and committed; requires referral attribution, fraud controls, reward/payment states, tax handling, and privacy boundaries; never place referral identifiers or payment data in general product telemetry. |
| `/warmed-accounts` (primary nav) | **O:** purchase/management offer for warmed TikTok/Instagram accounts, monthly account charge plus per-upload fee, configuration/review flow. | Tasmeemai will satisfy the publish-ready Channel outcome through **Managed Channel Onboarding**, while requiring authorization and Platform-compliant setup. | `intentionally adapted` and committed; match discovery, selection, pricing, configuration, review, provisioning progress, support, and management states without selling aged identities or simulating activity to evade enforcement. |

## #12: What implementation sequence yields reviewable vertical slices?

Blocked by: #1, #2, #3, #4, #5, #6, #7, #8, #9, #10, #11
Type: Discuss

### Question

What should be built, in what order, without duplicating existing infrastructure?

### Answer

Every slice is a production-complete portion of a fixed full-parity destination, not an MVP experiment or permission to omit later slices. Each ends in a deployable user outcome and an atomic commit/PR; routes are proposed and exact product naming remains reviewable.

| Slice | User outcome and routes | Reuse boundary | Key acceptance gate |
|---|---|---|---|
| **S1 — Dashboard IA and shell** | Authenticated `/dashboard`; unified desktop sidebar/top bar, mobile drawer, Workspace context, direction/language switch, and links to all current product areas. Redirect post-onboarding to `/dashboard`. | `Sidebar*`, `NavUser`, `AppSwitcher`, auth/onboarding guards, locale/direction store, Workspace APIs. No feature API changes. | Arabic RTL + English LTR + 390 px tests; deep links and editor microfrontend work; no business logic moves into navigation. |
| **S2 — Dashboard read model** | `/dashboard` shows derived activation progress, pending review/failures, next scheduled work, recent Artifacts/assets, and next-best CTA. | onboarding aggregate, assets, Channels, Posts, Runs, Approvals, Deliveries. | One read-only aggregation contract; partial failures render per card; no mutable checklist. |
| **S3 — Brand Profile center** | `/brand` lets users inspect accepted Brand Profile, propose corrections/source refresh, review diffs, and change Interface/Content language. | existing Brand Source/Profile/revision/generation pipeline. | New revisions never rewrite accepted history; mixed RTL/LTR fields tested. |
| **S4 — Unified Library** | `/library` tabs for publishing work, generated content/Artifacts, and uploaded media; shared picker for Studio/Compose. | asset APIs, Artifact projections, `/social/posts`, Media Pool, storage quotas. | No duplicated bytes or asset authority; search/filter URLs; origin/lineage/state visible. |
| **S5 — Complete content format system** | `/content` supports all observed formats: Slideshow, Wall of Text, Video Hook & Demo, Speaking Hook & Demo, Talking Head UGC, Green Screen Meme, Talking Head Green Screen, Product Spokesperson, Green Screen Mobile with App, Claymation, Character Swap, and Custom; each previews inputs and admission before running. | model discovery, Simple Studio, Content Workflow Revisions/Runs, editor handoff. | Registry-driven formats; every format has complete input, preview, progress, result, retry, and Arabic typography/caption states. |
| **S6 — Calendar/publishing convergence** | unified `/calendar`, `/compose`, `/channels`; friendly summary counters and canonical readiness/Approval/Delivery state. | current Social Hub, Publishing Settings registry, canonical publishing capabilities. | one publish authority; validation at client/release/provider boundaries; idempotent effects. |
| **S7 — Inspiration library** | `/inspiration` provides continuous rights-cleared discovery with daily ingestion, search, niche/topic/format filters, populated and gated states, metrics freshness, item details, and explicit remix provenance. | Brand Profile, Library, Artifact lineage, format launcher. | source rights and timestamps visible; no direct duplication; Arabic/MENA curation and every observed handoff included. |
| **S8 — Blitz review queue** | `/blitz` becomes resumable Ideas-to-review with source comparison, rationale, reject, edit, accept-to-draft, and configuration. | S3/S4/S5/S7 plus review-first publishing policy. | accept never publishes; actions idempotent; queue resumes; RTL gesture semantics explicit. |
| **S9 — Campaign Automations** | `/automations` builder for content mix, originality/remix ratio, Channels, cadence, admission preview, review, launch, and progress. | runtime Automations/Occurrences, Runs, Plans, Approvals, budgets/quotas. | immutable revisions; atomic launch; partial work and recovery visible; approval-first default. |
| **S10 — Performance Analytics** | `/analytics` provides all observed date ranges, headline metrics, social-traffic-versus-posts, cumulative/daily charts, account/Platform/content-type breakdowns, distribution/inbox-direct views, Website Analytics, GEO reporting, drilldowns, and Agent-readable queries. | Channel adapters, Social events, website measurement, runtime capability entrypoint. | source/unknown/freshness shown; aggregates reconcile; no causal claims from correlation. |
| **S11 — Product settings consolidation** | one settings sheet/routes for Account, Workspaces, Channels, storage/usage, budgets, credentials, language, timezone, notifications, and API/Agents. | Better Auth, current social settings, Studio Cockpits, agent pairing/tokens. | role-aware sections; secrets never rendered; mobile full-screen sheet; all mutations use existing authoritative services/capabilities. |
| **S12 — Persistent Influencers** | complete consented persona creation, training, generation, reusable character management, content sets, Channel connections, Blitz feed, lifecycle, and deletion. | Artifacts, Workflows, credentials, usage, Library, disclosure. | direct evidence for all Fastlane states plus explicit consent, abuse, disclosure, retention, and provider acceptance gates. |
| **S13 — Billing, credits, and referrals** | subscription and entitlement center, managed-credit balance/purchase/reservation/settlement/refund history, insufficient-credit handling, customer portal, and Refer & Earn lifecycle. | Usage Ledger evidence, separate managed billing ledger, payment/tax provider, entitlements, fraud controls. | BYOK and managed charges never conflate; all money movements reconcile; MENA currencies/taxes and Arabic receipts are tested. |
| **S14 — Managed Channel Onboarding** | compliant counterpart to `/warmed-accounts`: discover, price, configure, review, provision, connect, monitor, and support publish-ready Channels. | Channel registry, credential handoff, readiness, subscriptions/usage, support operations. | Workspace authorization and Platform compliance are evidenced; no aged-identity sale or enforcement evasion; every commercial and lifecycle state is represented. |
| **S15 — Guide, feedback, roadmap, and release lifecycle** | complete Guide center, localized tutorials/transcripts, Feedback with attachments, public roadmap/changelog, release-update notifications, Discord/community handoff, and support states. | product metadata, privacy-safe attachments, notifications, support workflow, localization. | every parity route and CTA is covered, versioned, accessible, and tested in Arabic RTL, English LTR, desktop, and mobile. |

No observed Fastlane user outcome is excluded from the destination. Deliberate non-copies are proprietary branding/copy/assets, literal aged-identity trafficking or enforcement evasion, and replacement of canonical capability/domain contracts with page-specific APIs.

## #13: What remains behind the evidence frontier?

Blocked by: #3, #4, #6, #7, #8, #9
Type: Research

### Question

Which unknown Fastlane states should be revisited only if they materially affect a later slice?

### Answer

- Paid Inspiration result cards, filters, details, and remix handoff.
- Automation steps 2–10, list cards, editing, launch, progress, error, cancellation, and completion.
- Influencer creation/training forms, consent, progress, reuse, failure, and deletion.
- Populated Library item actions, post rescheduling, metrics refresh outcomes, media-set editing, and deletion.
- Calendar item details/dragging, populated status counter labels, failed/paused recovery, and timezone behavior.
- Populated Analytics tooltips, drilldowns, exports, metric freshness, and Website Analytics setup.
- Billing portal/plan details and paid API-key lifecycle.
- Desktop/tablet breakpoints between 390 px and the inspected desktop width.

Resolution rule: direct lawful evidence is an implementation-readiness gate for each dependent slice. Unknown behavior may be planned as an explicit research dependency, but never guessed into acceptance criteria or used to reduce committed scope.

## Recommended first implementation slice

Start with **S1 — Dashboard IA and shell**. It is the foundational complete slice that changes the product from disconnected tools into one coherent Workspace while reusing existing routes and avoiding premature database or provider changes. It establishes the RTL/LTR, responsive, navigation, and authorization contracts every later full-parity slice depends on.

The complete S1 PR covers the shared shell, `/dashboard` entry and shell states, nav metadata, route redirects, localization strings, and shell tests. Trend ingestion, generation recipes, billing, and their domain tables belong to their already-committed dependency-ordered slices; their absence from S1 is sequencing, not scope reduction.
