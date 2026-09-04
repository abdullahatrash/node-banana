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
- **Parity baseline:** this map records the September 3, 2026 authenticated surface. Each feature must be re-audited before implementation; later Fastlane changes enter explicit parity-change review rather than silently moving the target.
- Product-language decisions in `CONTEXT.md` and ADRs 0001–0027 outrank Fastlane terminology. In particular: use **Workspace**, **Workspace Subscription**, **Plan Definition**, **Entitlement**, **Trial Grant**, **Brand Profile**, **Channel**, **Channel Onboarding Order**, **Platform**, **Inspiration Item**, **Remix Brief**, **Blitz Queue**, **Content Format Definition**, **Content Piece Draft/Revision**, **Creator Persona**, **Content Acceptance**, **Artifact/Candidate Output**, **Media Set**, **Content Theme**, **Publishing Plan**, **Publishing Approval**, **Publishing Delivery**, **Generation Credit**, **Managed Execution Quote**, and **Content Operations Runtime**. Tasmeemai is the customer-facing product name; Node Banana remains a repository codename during migration.
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
- **I behavior:** shell data is identity + current Workspace + Entitlements + subscription/credit counters; navigation is client-side; feature gates are enforced server-side as well as visually.
- **Node Banana now:** authenticated product is split across `SimpleStudioLayout`, `SocialLayout`, standalone `/blitz`, `/studio/*`, `/agents`, and the editor microfrontend. `AppSwitcher` jumps among pillars. `/dashboard` is classified as a product path but has no page. Both Studio and Social use the same shadcn sidebar primitives, but navigation, headers, copy, and mobile behavior are duplicated and largely English-only.
- **Parity:** `partial`.
- **Arabic/English:** build one direction-aware product shell on stable semantic message keys with complete authored `ar` and `en` catalogs. Use logical CSS (`start/end`, `ms/me`, `border-s/e`) and mirror drawer, chevrons, progress direction, and breadcrumb flow. Keep brand marks, media controls, numeric identifiers, URLs, handles, and code LTR where appropriate. Arabic is the default Interface Language; English must produce a native LTR layout, not a mirrored Arabic screenshot. See #14 for the dedicated i18n contract.
- **Dependencies/risks:** route compatibility, editor microfrontend boundary, workspace membership/selection, existing onboarding guards, and preserving deep links. Risk: a visual shell rewrite could accidentally fork business logic or hide operational Cockpit routes.
- **Acceptance:** `/dashboard` is the authenticated landing page after onboarding; the primary navigation directly reaches Dashboard, Blitz, Inspiration, Automations, AI Studio, Influencers, Content, Library, Calendar, Analytics, Brand, and Settings; Compose, Channels, Approvals, Deliveries, Agents, and operational Cockpits use contextual sub-navigation; settings sections are URL-addressable while rendering as a desktop sheet and mobile full-screen page; desktop collapse and 390 px drawer are keyboard accessible; Arabic and English visual tests cover both directions; route authorization remains server-enforced.

Decision: implement a unified Tasmeemai shell first, linking through to existing feature routes until each canonical surface replaces them. Preserve old deep links with redirects and compatibility adapters, then retire duplicate shells; do not rename domain resources or duplicate their APIs to match Fastlane labels.

## #2: What belongs on the authenticated home dashboard?

Blocked by: #1
Type: Research

### Question

What should replace Fastlane `/home` for an Arabic-first MENA creator?

### Answer

**Fastlane surface — `/home`, first primary nav item.**

- **O UI:** centered promise (“Lets get your product seen.”), a 0/4 Quickstart card (“Swipe content in Blitz”, “Connect your account”, “Upload a demo video”, “Make your first post”), progress rule, Continue setup CTA, Changelog link, Trending Content empty state, and a long categorized FAQ. A release-update toast can overlay the page.
- **O responsive:** desktop centers a narrow activation card in open space; mobile makes the card almost full width, keeps the four task rows touch-sized, and stacks Changelog and later sections.
- **I behavior:** operational completion is derived from Workspace activity rather than manually checked flags; tutorial completion/dismissal is per person; trending content is Workspace/brand-filtered; changelog/update dismissal is per person.
- **Node Banana now:** onboarding is resumable and durable, creates a Workspace and reviewed Brand Profile, and hands off to `/blitz`. `/blitz` shows one activation Artifact with provenance and links to copy/image generation. There is no authenticated `/dashboard`, readiness summary, aggregate activity, or contextual next-best action.
- **Parity:** `partial`.
- **Arabic/English:** localize task order and copy; preserve independent Interface Language and Content Language; format dates, counts, and time zones by locale. Arabic copy should be authored, not mechanically translated. FAQ topics should cover MENA-relevant Channel rules and safe publishing, not Fastlane’s account-warming advice verbatim.
- **Dependencies/risks:** needs read-only projections across Brand Profile, assets, Channels, Content Pieces, Runs, Plans, Approvals, and Deliveries plus separate per-person guidance state. Risk: inventing another mutable checklist or making one member's tutorial actions define Workspace readiness.
- **Acceptance:** **Workspace Activation** derives Brand Profile acceptance, media upload, Channel connection, Content Acceptance, and first scheduled publishing; **User Guidance Progress** independently stores dismissible learning steps; one deterministic **Dashboard Next Action** follows an inspectable priority policy over activation, failures, expiring consent/Approvals, scheduled work, Generation Credit capacity, and stale metrics; Copilot may explain or execute it but never secretly ranks it; dashboard renders useful empty, partial, ready, loading, and degraded states; every CTA lands on a live route; no dashboard-only business mutation is introduced; RTL/LTR and narrow-screen snapshots pass.

Decision: the dashboard is a Workspace command center: activation progress, work needing review, upcoming publishing, recent Content Pieces/Artifacts, and one deterministic explainable Dashboard Next Action. FAQ/changelog are secondary, and Copilot never becomes a hidden recommendation engine.

## #3: How should discovery, Inspiration, and Blitz map to Tasmeemai?

Blocked by: #1, #2
Type: Research

### Question

Which parts of Fastlane’s trend-to-approval loop should be adopted?

### Answer

**Fastlane surface A — `/inspiration`, primary nav after Blitz.**

- **O UI:** paid gate headed “Inspiration Library”; describes a daily searchable viral short-form feed filtered by niche, topic, and format, with an Upgrade CTA. The authenticated free-trial view did not reveal cards, filters, detail screens, or remix actions.
- **I behavior:** background ingestion/enrichment of trend items, engagement snapshots, niche/format tagging, search, entitlements, ranking, and a remix handoff that preserves source attribution.
- **Node Banana:** no trend corpus. Prompt Library is saved/public prompt discovery, not market evidence.
- **Parity:** `missing` for trends; `unknown` for Fastlane’s paid result/detail interactions.
- **Acquisition boundary:** Tasmeemai uses official APIs, licensed datasets, user-submitted links, lawful public metadata, and embeddable source media. An **Inspiration Item** retains source, capture time, metric freshness, rights status, and permitted remix behavior; it is not silently imported as a Workspace Artifact.

**Fastlane surface B — `/blitz`, primary nav.**

- **O UI:** swipe/review workspace with “Remixed From” reference media and engagement counts, one centered generated vertical card, format chip, “Why This Content?”, mute, Reject, Edit, Approve, Smart positioning, and Configure. Mobile hides the side-by-side source panel behind “View Original” and keeps the card/actions centered. Empty/loading states were not observed.
- **I behavior:** a bounded Workspace Blitz Queue is generated from Brand context + trend/template sources; reject/accept advances it; Content Acceptance creates or selects a Content Piece Revision and may prepare a Publishing Plan; scheduled or manual replenishment obeys target capacity, format mix, Remix ratio, Brand/language constraints, provider mode, and spend ceiling.
- **Node Banana:** `/blitz` is a responsive, bilingual first-value page for one onboarding Activation Artifact. It has rationale, suggested formats, Brand Profile provenance, and creation CTAs, but no queue, source trend, edit, accept/reject, or publishing handoff.
- **Parity:** `partial`.
- **Arabic/English:** horizontal swipe semantics must follow explicit Reject/**Accept Content** meaning rather than assuming physical left/right under RTL. Overlay copy must handle Arabic shaping and mixed text. Trend metadata, sources, and rights must remain visible. Video controls stay spatially consistent.
- **Dependencies/risks:** Brand Profile, immutable Artifacts/lineage, rights-aware Inspiration Items, Remix Briefs, Content Pieces, reusable format definitions, generation Runs, and draft Publishing Plans. Major risks are copyright, deceptive copying, and conflating Content Acceptance with durable Publishing Approval.
- **Acceptance:** Inspiration ranking exposes “Why this appears” from recency, source performance, metric freshness, Brand fit, region, Content Language/Arabic Variety, format, rights confidence, and explicit preferences; ML is only a visible scored signal; every card shows source/provenance; a Remix Brief records permitted topic/hook/pacing/structure influence and excludes protected expression; text/frame/audio similarity checks run before Content Acceptance; Reject and Content Acceptance are idempotent; rejection excludes the exact proposal and optional structured reasons feed only a reviewable Content Preference Proposal, never silent Brand mutation; acceptance never schedules or publishes; editing appends explicit Content Piece and Artifact lineage; the Blitz Queue resumes across devices; viewing never generates billable work; replenishment stops at capacity and admission/spend limits; RTL gestures and keyboard buttons agree.

Decision: build a provenance-first bounded **Blitz Queue** after the content format and library spines exist. It supports configured daily and manual replenishment but never an unbounded billable infinite feed; do not ship an untraceable viral-content scraper or copy Fastlane’s swipe gestures before explicit action semantics are proven.

## #4: How should campaign Automations be represented?

Blocked by: #1, #5, #7, #8
Type: Research

### Question

Can Fastlane’s batch campaign workflow reuse the existing runtime instead of creating another job system?

### Answer

**Fastlane surface — `/automations`, plus `/automations/{id}/edit`.**

- **O list:** header, description (“Batch-generate content and schedule it straight into your calendar”), quota (`0 / 1 used`), New automation, and first-use empty state.
- **O builder step 1:** a 10-step progress indicator; optional campaign name; four-part content mix (Slideshow, Wall of text, Green screen, Video hook) constrained to 100%; a 50% Remix ratio slider; Continue. Later steps and launched states were not inspected.
- **I behavior:** Fastlane allocates a draft campaign identity on entry; later steps likely select Channels, schedule/cadence, media/configuration, review, and launch. Launch probably fans out background generation and scheduled publishing with quota/credit admission.
- **Node Banana:** `/social/agents` exposes legacy automation rules/tasks and notification control. The Content Operations Runtime has canonical Automation/Revisions/Occurrences, outbox intents, execution leases, capability contracts, budgets/quotas, Runs, Artifacts, Publishing Plans, Approvals, and Deliveries. There is no creator-oriented campaign builder.
- **Parity:** `partial` in backend capability, `missing` in creator workflow.
- **Arabic/English:** use a direction-neutral stepper; localize format names and explanatory copy; cadence uses Workspace IANA timezone and locale-aware dates. Percent controls must remain mathematically left-to-right even when labels are RTL.
- **Dependencies/risks:** format catalog, generation workflows, Channels, calendar capacity, admission preview, budgets/quotas, approval policy, durable occurrence inspection. Risk: duplicating `socialAutomation*` and runtime Automation models or implying background work is complete at acceptance.
- **Acceptance:** the untouched first screen is locally provisional; the first substantive Continue/save idempotently creates the durable Automation and first Revision, after which autosave, resume, discard/archive, and deep links work; the direction-neutral ten-step sequence covers (1) basics, (2) format mix, (3) Inspiration/Remix, (4) Brand/language/Arabic Variety, (5) Personas/demo media/themes/sets, (6) Channels/variants, (7) cadence/timezone/bounds/calendar capacity, (8) execution mode/models/credits/budgets/admission, (9) review mode or Auto-publish Grant, and (10) validation/activation/progress; launch returns Durable Acceptance; content mix totals 100%; admission failures do not partially launch; `request_human` is the default and `evaluate_policy` requires an exact active grant; resuming and cancellation are idempotent.

Decision: build the complete deep-linkable ten-step UI on the runtime Automation and Application Capability boundary; legacy social automation is a migration source, not the new campaign domain. Avoid empty-row litter by delaying durable creation until substantive save. Both review-first and true scheduled auto-publishing are supported, but launch never invents authority beyond an exact bounded Auto-publish Grant.

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
- **I behavior:** each format is a versioned Content Format Definition with required inputs, compatible language/Arabic Variety, media constraints, preview schema, exact Workflow Revision and Model Policy, caption rules, duration/aspect limits, Managed Execution Quote policy, editor handoff, and Artifact outputs; a mutable editor-owned Content Piece Draft with optimistic versioning promotes through validation to immutable Revisions; batch generations create sibling Candidate Outputs under one origin.
- **Node Banana:** generic generation plus a separate `/editor/*` microfrontend. No product-level format registry or guided multi-step content recipes.
- **Parity:** `partial`.
- **Arabic/English:** make format definitions declare supported Content Languages, typography/caption safety, direction, and text limits. Arabic captions require shaping, bidi isolation, safe line breaking, and rendered-video tests. Editor controls mirror; the video canvas itself does not blindly mirror.
- **Dependencies/risks:** Content Piece Drafts/Revisions, optimistic conflict resolution, model capabilities/schemas, Content Workflow Revisions, Run admission preview, media assets/sets, licensed Themes, production renderer, editor handoff, usage evidence, and template licensing. Risk: hardcoding formats directly into React, mutating Artifacts as editable documents, silently hiding provider identity, or labeling browser approximations as final output.
- **Acceptance:** versioned Content Format Definitions drive launcher, Content Piece Draft configuration, validation, workflow input, quote/admission preview, progress, result lineage, and editor handoff; React does not independently encode format contracts; curated Model Policy defaults expose exact provider/model/version/region and constrain advanced overrides to compatible operations; autosave uses optimistic versioning and conflicts never silently overwrite; Save, Preview, or Generate promotes a validated immutable Revision; Custom imports creator media into the same lifecycle while arbitrary Workflow authoring remains in the Cockpit; canonical Media Sets and versioned licensed Content Themes are pinned by consuming revisions; immediate Layout Preview is labeled approximate and production Render Proof uses final fonts, bidi, captions, timing, and safe areas; incompatible Arabic Variety, font, voice, or caption choices block or require explicit supported fallback; all 11 observed named formats plus Custom pass complete state matrices; core AI Studio stays usable and failed/outcome-unknown Runs remain inspectable.

Decision: expose both **AI Studio** and **Content** as first-class experiences. AI Studio remains the expert/raw generator, while Content is the complete guided format system; both share transparent model discovery, Workflows, Runs, Artifacts/Candidate Outputs, usage, and media selection without redirecting to or replacing one another. Editable autosave remains a Draft; immutable revision history and production Render Proof prevent silent overwrite or misleading preview.

## #6: How should persistent AI Influencers reach full parity?

Blocked by: #5, #7, #10
Type: Research

### Question

What complete Tasmeemai capability should correspond to Fastlane-style reusable AI characters?

### Answer

**Fastlane surface — `/influencers`.**

- **O UI:** heading and help, credit balance/purchase, New influencer, first-use empty state, and three-step onboarding: create a persona and train a persistent character; generate images then videos from an image; configure social connections/content sets that feed Blitz.
- **I behavior:** Creator Persona records own traits, kind, training source/consent, provider training Runs, status and reusable model reference; generated Artifacts retain persona lineage; content sets join personas/media to Blitz configuration.
- **Node Banana:** no character/persona/training resource. Reference images and image-to-video are ephemeral inputs; Artifacts and provider Workflows provide the foundation for the committed implementation.
- **Parity:** `missing`.
- **Arabic/English:** persona identity, Content Language, and **Arabic Variety** are separate. Support MSA plus launch-market Gulf, Egyptian, Levantine, and Maghrebi varieties, exposing provider capability and any fallback explicitly; consent, gender/cultural representation, disclosure, pronunciation, and bidi-isolated names/handles remain visible.
- **Dependencies/risks:** explicit Synthetic Persona versus Consented Likeness Persona model, consent and likeness policy, provider/model evaluation, immutable training provenance, credential/budget controls, disclosure metadata, and safe deletion/retention. High abuse, biometric, IP, and cost risk.
- **Acceptance:** no training without explicit rights/consent evidence; synthetic personas and authorized real-person likenesses are supported; public-figure impersonation, deceptive identity use, unprovenanced sources, and minors without a separately approved guardian process are prohibited; lifecycle is `draft → consent_review → ready_to_train → training → review → active`, with `training_failed`, `suspended`, `consent_expired`, and terminal `deleted`; only active Personas enter new Content Piece Revisions; training is a durable Run with failure/retry; deletion revokes future use while retaining required evidence; generated media carries lineage/disclosure; Arabic Variety and caption tests pass before launch.

Decision: “AI Influencers” remains a discoverable section label, while **Creator Persona** is the canonical resource with explicit Synthetic Persona and Consented Likeness Persona kinds. Implement the complete persona, consent, training, generation, connection/content-set, Blitz handoff, lifecycle, and safe-deletion experience as a distinct bounded product slice after its Workflow, Content Piece, and Artifact prerequisites.

## #7: What is the canonical library and media model?

Blocked by: #1
Type: Research

### Question

How can Fastlane’s Library be matched without creating more asset silos?

### Answer

**Fastlane surface — `/library`.**

- **O tabs:** My Posts (type menu, Refresh Metrics, All/Scheduled/Drafts/Published/Needs attention); My Content (type/status filters and item count); My Media Bank (sets, New set, drag/drop/click upload for JPG/PNG/WebP/MP4/MOV, search, image/video/category filters, Upload and Select). All inspected tabs were empty.
- **I behavior:** Posts join publishing state + refreshed Platform Metric Observations; Content represents editable Content Pieces; Media Bank stores raw reusable files and named/category Media Sets without duplicating blobs; selection is reusable from generators, formats, and publishing.
- **Node Banana:** `/simple-studio/library` lists Workspace assets by photo/video/copy; `/social/media` derives media from Posts; `/social/posts` filters post status; Compose Media Pool browses/uploads canonical Workspace assets; Prompt Library is separate. Asset APIs support presign/finalize, quotas, soft deletion, downloads, project scoping, and cleanup. The UI exposes overlapping libraries.
- **Parity:** `partial`, with stronger underlying storage controls than the visible product shell suggests.
- **Arabic/English:** filters and tabs mirror naturally; media metadata uses `dir=auto`; search must normalize Arabic letter variants/diacritics without corrupting exact filenames; dates/sizes localize; media order should not reverse unexpectedly.
- **Dependencies/risks:** choose Artifact vs legacy `assets` authority per item type; migration/read model; signed delivery; storage quotas; lineage; post metrics. Risk: copying Fastlane’s three nouns while preserving three different databases.
- **Acceptance:** one `/library` presents URL-addressable Posts, Content, Media, and Prompts destinations; Content cards are Content Pieces rather than raw Runs or mutable Artifacts; friendly status is a projection while Content Piece lifecycle remains only active/archived/deleted; Prompt Library remains a strict-superset creation-input collection; demo videos and named collections are Media Sets over canonical media; every card identifies origin, state, and reusable actions; deletion is recoverable when unreferenced and blocked with exact dependency details when Plans, Approvals, Deliveries, Automations, Persona training, retention, or audit evidence require it; no bytes are duplicated; Compose, AI Studio, and guided Content use the same canonical pickers.

Decision: consolidate the user experience around the existing Workspace media spine while projecting immutable runtime Artifacts. Keep Posts as publishing resources, Content Pieces as editable creative works, Prompts as reusable inputs, and media/Artifacts as files; do not collapse these identities merely because they share one Library shell.

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
- **Acceptance:** month/week/day/list all read one canonical projection; a Publishing Plan references the exact Content Piece Revision it distributes; dragging or rescheduling creates a new Plan Revision, reruns validation, and supersedes unconsumed Approval; an already released Delivery uses explicit cancel/reschedule and states when provider cancellation is no longer guaranteed; paid Runs with valid reservations and already-created Deliveries continue through later subscription failure, while new paid effects and future Automation Occurrences block at admission; per-target readiness and failures are visible; retry/reconciliation cannot duplicate provider effects; mobile calendar remains readable in both directions.

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
- **I behavior:** periodic and on-demand Platform Metric Observation ingestion, time-series projections, post/account/content-type dimensions, site event collection and attribution safeguards. Refresh requires rate limiting and last-updated evidence.
- **Node Banana:** `/social/analytics` shows total/published Post counts, recent ops-event count, and status distribution only. Runtime usage/cost/observability Cockpits are operational evidence, not audience performance. ADR 0009 requires analytics to be readable through the Agent Interface; `CONTEXT.md` names GEO Citation Tracking as a north-star reporting metric.
- **Parity:** `partial`.
- **Arabic/English:** charts mirror labels/tooltips but keep time increasing consistently; Arabic numerals and compact units are locale-aware; Platform/handle strings use bidi isolation; support local timezone and UTC evidence. Reporting copy must distinguish correlation, attribution, estimated, and unknown values.
- **Dependencies/risks:** Channel metric adapters, immutable Platform Metric Observations, comparability registry, content taxonomy, website event privacy/consent, Agent capabilities, and GEO tracking. Risks: provider API gaps, retroactive metric changes, false attribution, forced universal totals, and mixing runtime cost telemetry with marketing outcomes.
- **Acceptance:** every metric shows exact Platform definition, source, scope, range, capture time, freshness, and unknown/unavailable states; only demonstrably comparable definitions normalize or aggregate; projections reconcile to observations; manual or scheduled Platform Metric Refresh is durable/idempotent per Channel/resource set, updates sources independently, preserves prior observations, exposes per-source failure/retry, and respects provider limits without failing the entire page; Analytics and Agent Interface use the same query capabilities; Arabic/LTR chart tests cover zero, sparse, and mixed-Platform data.

Decision: the complete Analytics surface includes post/account/content performance, metric freshness, Website Analytics, and GEO Citation Tracking. Website collection is Workspace-opt-in, first-party, campaign-tagged, consent-aware, retention-configurable, and region-aware; reporting distinguishes correlation from attribution and never asserts unsupported causality.

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
- **Acceptance:** `/brand` reads the accepted revision, compares source refresh proposals, and creates a new reviewable revision; old Artifacts retain their pinned profile reference; switching Workspace warns about unsaved local edits, invalidates scoped caches, opens fresh Copilot context, and never rebinds uploads, Runs, Content Pieces, Creator Personas, Channels, credits, Plans, Approvals, or Deliveries; Interface/Content language changes are explicit and reversible; destructive actions require confirmation and recovery details.

Decision: expose the existing Brand Profile as a first-class center; do not flatten it into Fastlane’s unversioned-looking sections.

## #11: Which secondary settings and commercial surfaces need parity?

Blocked by: #1, #7, #8, #10
Type: Research

### Question

Which authenticated secondary surfaces are product requirements, and which should be intentionally different?

### Answer

| Fastlane route/surface (placement) | Observed UI and inferred behavior | Node Banana/Tasmeemai mapping | Parity; locale; dependencies and acceptance |
|---|---|---|---|
| Settings → Account (sidebar button; overlay) | **O:** profile/security tabs, email identities, connected login accounts, update profile, add email, delete account, sign out. **I:** identity-provider and account-lifecycle APIs. | Settings → Account now consolidates bilingual Profile and Security tabs over Better Auth: display-name update, current-email approval plus new-email verification, linked login methods with last-method protection, configured OAuth linking, password change with other-session revocation, active-session review/revocation, and sign-out. It explicitly separates identity, membership, Workspace Closure, and resource lifecycle and links to their authoritative surfaces. | `partial`; safe identity erasure still requires a dedicated preflight spanning every membership/owned Workspace, final-Owner transfer, export/cooling-off/closure completion, reauthentication, and append-only minimal audit evidence. Raw Better Auth hard-delete remains intentionally disabled because it cannot satisfy those cross-Workspace invariants. |
| Settings → Billing | **O:** “Billing & Subscription” shell; detailed plan state did not render in the inspected trial. **I:** subscription/customer portal and entitlements. | `/pricing`, `/billing`, and Settings → Billing expose versioned Plan Definitions, trial eligibility, Workspace Subscription state, secure checkout, merchant portal, and role-gated administration. The authoritative commercial projection remains separate from External Provider Spend. | `existing` core and bilingual; production purchase/portal actions truthfully report unavailable until a configured replaceable Merchant-of-Record Adapter is present. Invoice/refund/dispute presentation remains a later merchant-backed presentation increment, not a fake local invoice. |
| Settings → AI Credits | **O:** balance, Buy more, monthly reset vs non-expiring add-on credits, recent ledger activity. **I:** credit ledger, reservation, settlement. | `/billing` and Settings → Billing expose total Generation Credits, separate expiring allowance/non-expiring purchased/referral buckets, credit packs, visibly held reservations, recent immutable ledger activity, and active exact Managed Execution Quotes with role-gated acceptance. The backend persists allowance-first allocation, release/refund, and outcome-unknown holds alongside separate BYOK Usage evidence. | `existing` and bilingual. The authenticated server Workspace—not mutable browser storage—scopes reads and commands. A dedicated paginated archive remains appropriate when customers need more than the latest 100 ledger records; current observed Fastlane parity requires recent activity rather than an unbounded archive. |
| Settings → Storage | **O:** used/limit progress and Upgrade. **I:** Workspace storage aggregation. | `/settings?section=storage` now exposes the server-authorized Workspace quota, active canonical bytes and asset count, unexpired in-flight upload reservations, recoverable soft-deleted bytes/count, and a per-media-type breakdown. The progress projection includes active usage plus reserved uploads; actions lead to the canonical Library for exact-item review and Billing for plans. | `existing` and bilingual for the observed surface. The settings view cannot hard-delete or trigger background purge, and it never scopes from mutable browser storage. Soft-deleted bytes are reported separately and excluded from active use; safe cleanup remains subject to the canonical retention lifecycle. |
| Settings → Integrations | **O:** four social cards, connection allowance, status/help; Website Analytics enable. | Intentionally presented as `/settings?section=channels`: it exposes the exact versioned Workspace Subscription allowance, active/remaining capacity, healthy/reauthorization/paused counts, and every registered Platform's server readiness, connected count, and image/video/carousel/verified-metrics capabilities. Management stays in canonical Channels and Managed Onboarding. The legacy `/social/integrations` summary redirects to Channels instead of duplicating state. | `existing` and bilingual for Channel connection parity, with broader Platform coverage. Initiation and final account creation/re-enable resolve immutable Plan Definition entitlements—not the legacy tier—and serialize admission to prevent concurrent OAuth flows exceeding the limit. Only official OAuth, supported app passwords, API credentials, device authorization, or vetted Credential Handoff are accepted; platform-password capture and covert session automation remain prohibited. Website Analytics remains a separate consented analytics-source capability rather than being mislabeled as a Channel. |
| Settings → Demo Videos | **O:** MP4/MOV upload, 100 MB and 30s limits; videos feed hook formats. **I:** dedicated reusable media collection. | `/settings?section=demoVideos` manages one ordered `demo_videos` Media Set over canonical Workspace Assets. It can upload directly to configured object storage or add an already-verified Asset, reorder membership, and remove membership without deleting or copying the underlying bytes. | `existing` and bilingual. The browser rejects obvious type/size/duration mistakes before upload, while authoritative admission streams the stored object through server-side hashing and media decoding and enforces MP4/MOV, 100 MB, and 30 seconds. Each change creates an immutable Media Set revision with optimistic concurrency; Content/Campaign consumers pin exact revisions, and the last removal archives the empty set without erasing its Assets. |
| Settings → Remix | **O:** up to 50 slideshow themes; curated and user Media Bank sets; remove/add. **I:** ordered configuration references licensed sets. | `/settings?section=remix` presents 50 original first-party Content Themes with authored Arabic and English names, explanations, culturally reviewed notes, Arabic-safe typography, palettes, immutable revision digests, search/filter, and add/remove controls. Existing Workspace Media Sets appear from their canonical Library projection rather than copied settings state. Content and Campaign consumers admit the catalog license only when it is bound to the exact curated theme ID, revision, and digest, while user media retains its separate rights evidence. | `existing` and bilingual. These are original Tasmeemai configurations—not copies of Fastlane themes, proprietary source media, named-artist styles, or third-party brands. Admission is serialized against a 50-active-theme Workspace limit, mutations are retry-safe, archived themes reactivate their exact immutable revision, and Content Pieces/Campaigns pin exact Theme and Media Set revisions. Mixed-direction names, Arabic shaping, LTR digests/palettes, safe 9:16 composition, cultural stereotyping exclusions, and rights boundaries are explicit. |
| Settings → Preferences | **O:** timezone and region selectors, including MENA entries. **I:** Workspace scheduling defaults. | `/settings?section=preferences` persists an 18-market MENA content context, any valid IANA timezone, and all seven week-start choices in `workspace_settings`; Calendar and new Campaign Automations consume the authoritative scheduling projection, while new YouTube chart forms inherit the content market. | `existing` and bilingual; changes affect future authoring defaults and civil-time projections without rewriting historical instants or already-authored Campaigns. Content market is explicitly separate from provider processing region and data-residency policy. |
| Settings → Privacy | **O:** X Ads attribution toggle/status and irreversibility warning for already-sent events. | `/settings?section=privacy` now exposes the existing personal, Workspace-scoped product-analytics consent as a separate purpose: explicit 30/90/365-day activation, immutable consent revisions, automatic expiry, enumerated content-free events, rotating pseudonyms, at-most-90-day retention, and revocation that stops collection and deletes retained product events plus experiment assignments. The same surface truthfully shows X Ads attribution as inactive and confirms that no X Pixel or Conversion API integration is loaded. | `partial` and bilingual. Product analytics consent can never authorize advertising attribution, Workspace-owned metrics, billing/security evidence, generation lineage, or legally required audit retention. Full observed parity still requires a separate X Ads notice/consent contract, regional review, configured server-side delivery adapter, pending-event erasure, exact delivery receipts, and the explicit fact that revocation cannot recall already-delivered external events; no advertising toggle may appear active before those conditions exist. |
| Settings → Language | **O:** generated Content Language only; Arabic is one option; UI remains English. | `/settings?section=language` separately persists the signed-in person's Workspace-specific Interface Language and the Workspace default Content Language. Arabic and English are supported end to end; Simple Studio, new Content Pieces, Campaign Automations, lawful Inspiration submissions, and new performance evidence/syncs inherit the Workspace default without rewriting pinned drafts or existing evidence. | `existing` and strategically stronger; bilingual RTL/LTR presentation preserves the distinction between interface chrome and generated content, and each setting has independent authorization and failure recovery. |
| Settings → Notifications | **O:** email master switch, lead/activity/failed-post/disclosure-review digests. | `/settings?section=notifications` persists a validated per-person/per-Workspace publishing delivery policy: in-app and email channels, independent Arabic/English delivery language, daily/weekly cadence, IANA-timezone quiet hours, optional progress/success/channel categories, and reversible optional mute. Digest dispatch scopes its cache by Workspace + user and groups incompatible channel policies separately. | `existing` for current social publishing events and bilingual; known post/dispatch failures and Channel reauthorization bypass optional mute/category/cadence/quiet-hour suppression. Cross-product billing, security, consent-expiry, and approval notifications still require their canonical event producers and authored renderers before global notification parity is complete. |
| Settings → API | **O:** docs, downloadable agent skill, paid gate for API keys. | `/social/settings` API tokens/provider keys; `/agents` pairing and authority; `/api/v1/*`, `/api/mcp`, CLI/MCP capability registry and parity contracts. | `existing` and deeper, but fragmented; Entitlements may gate keys, Principal count, managed execution, and capacity, but never create different behavior or bypass Principal/Workspace resolution, authorization, Approval, idempotency, or audit. |
| Global Copilot dialog | **O:** floating launcher, new conversation, history, platform-advice prompt; mobile dialog fills the viewport. Action tools were not observed. **I:** persisted conversations and contextual product help. | `/social/copilot` is expanded into the single Workspace- and route-aware **Tasmeemai Copilot**, retaining persisted conversations and transport-neutral tools while operating canonical resources. | `partial` and committed; advice plus Content Piece, Workflow, Plan, Run, and analytics actions use shared Application Capabilities; conversations never cross Workspace; no hidden mutations; publishing remains explicitly Approval-backed. |
| `/guide` (sidebar) | **O:** video tutorial buttons for Blitz, manual creation, formats, Calendar/Library/Brand/Feedback, Influencers. | Onboarding education only; no guide center. | `missing` and committed; versioned Guide Entries bind feature/route, authored Interface Language, media/transcript version, minimum product version, and review state; CI checks routes and current Arabic/English coverage before parity completion. |
| `/feedback`, `/roadmap`, `/changelog` (sidebar/links) | **O:** roadmap/changelog links and categorized feedback form with up to 10 attachments/16 MB; release toast links to changelog. | No equivalent product UI. | `missing` and committed; Feedback creates a trackable case/reference with consented privacy-safe attachments and retention; Roadmap Items remain non-binding planned outcomes; Release Notes are localized shipped facts tied to exact versions/routes; all submission, correspondence, notification, error, and resolution states are included. |
| `/refer-and-earn` (sidebar) | **O:** referral link/QR, embedded affiliate dashboard, clicks/leads/sales/rewards/payment settings. | No referral program. | `missing` and committed; support selectable Generation Credit or cash rewards owed to a verified Referral Recipient, with attribution, fraud holds, refunds/clawbacks, thresholds, tax documents, currency-conversion evidence, payment settings, and a payout ledger separate from Workspace billing; never place referral identifiers or payment data in general telemetry. |
| `/warmed-accounts` (primary nav) | **O:** purchase/management offer for warmed TikTok/Instagram accounts, monthly account charge plus per-upload fee, configuration/review flow. | Tasmeemai will satisfy the publish-ready Channel outcome through Managed Channel Onboarding and Channel Onboarding Orders: customer-controlled guided setup, supplemented by vetted regional partners, with secrets entering only through Credential Handoff/Vault boundaries. | `intentionally adapted` and committed; full order lifecycle is draft, quoted, payment pending, accepted, customer action, partner action, readiness review, ready to connect, connected, blocked, cancelled, refunded, or failed; Partner Service Assignments are time/purpose bounded and grant no reusable secrets, impersonation, or publishing authority. |

Decision: gated capabilities stay visible with a useful preview, exact Entitlement requirement, current allowance, and localized upgrade path, while server-side authorization and policy remain authoritative. Existing owned data and billing evidence remain readable after downgrade wherever legally and operationally possible.

## #12: What implementation sequence yields reviewable vertical slices?

Blocked by: #1, #2, #3, #4, #5, #6, #7, #8, #9, #10, #11, #14, #15, #16
Type: Discuss

### Question

What should be built, in what order, without duplicating existing infrastructure?

### Answer

Every slice is a production-complete portion of a fixed full-parity destination, not an MVP experiment or permission to omit later slices. Completed slices may ship behind real navigation and entitlement controls, but no dead route is presented as finished and Tasmeemai does not claim full parity until the entire baseline passes. Each slice ends in a deployable user outcome and an atomic commit/PR.

| Slice | User outcome and routes | Reuse boundary | Key acceptance gate |
|---|---|---|---|
| **S0 — Arabic-first i18n foundation** | Every customer-facing surface resolves stable semantic keys through complete authored Arabic and English catalogs; locale controls document direction and server/client messages consistently. Public indexable pages use `/ar`/`en` prefixes; authenticated resource paths remain locale-neutral. | preserve the existing Arabic-default cookie/store, root `lang`/`dir`, direction provider, logical UI primitives, and user-preference column while replacing component-local copy objects and locale branches with extracted UI/server catalogs, formatting, validation/capability-error, email, and notification boundaries. | shared shell/auth/onboarding/common copy extracted immediately; a legacy-literal allowlist can only shrink; no new inline product copy or raw keys; missing required `ar`/`en` keys and interpolation drift fail checks; production defects emit Localization Incidents and use authored fallback; plural/gender/interpolation/bidi/pseudo-locale, hostile mixed-direction, numeral/calendar, accessibility, and RTL/LTR screenshot tests pass. |
| **S1 — Dashboard IA and shell** | Authenticated `/dashboard`; unified desktop sidebar/top bar, mobile drawer, Workspace context, direction/language switch, and direct primary links to every Fastlane-equivalent destination; deeper Tasmeemai controls use contextual sub-navigation. Redirect post-onboarding to `/dashboard`. | S0 catalogs plus `Sidebar*`, `NavUser`, `AppSwitcher`, auth/onboarding guards, locale/direction store, Workspace APIs. No feature API changes. | authored Arabic RTL + English LTR at desktop, tablet, and 390 px; every authorized capability remains reachable; deep links and editor microfrontend work; no dead routes or business logic in navigation. |
| **S2 — Workspace governance and trust** | complete invitations/membership, built-in and Custom Workspace Roles, Portfolio coordination, Review Guest links, Approval Policies, step-up authentication, customer Audit Trail/export, Data Region and Retention policies, Safety Decisions/Appeals, durable Bulk Operations, and import/Workspace Export. | existing Better Auth membership, exact capability/grant runtime, Approval Authority, Security Events, Retention Policies/Tombstones, capability idempotency, Workspace isolation, storage, and support workflow. | no broad role implies Approval/credential/spend; every cross-Workspace action pins its target; guest scope is exact and expiring; audit/export is authorized and manifested; residency claims are verified; bulk outcomes are per-item and ambiguity-safe; safety appeals cannot create bypasses. |
| **S3 — Operational quality and release controls** | shared Durable Operation Status/progress, bounded Model Fallback Authorization, Experience Performance Budgets, Supported Client and WCAG 2.2 AA matrices, consent-aware Product Telemetry/Experiments, expiring Release Flags, localized Service Incident status, Recovery Objectives/restore drills, and Contract Migration tooling. | existing runtime snapshots/events, effect outcomes, model registry/policies, observability, test harness, Data Region/Retention policies, Parity Matrix, and versioned capability contracts. | no silent provider substitution or invented progress; MENA performance and RTL/LTR accessibility budgets pass; telemetry is content-free; flags expose only complete slices; restore and migration drills reconcile external effects; unknown parity cells remain blocking. |
| **S4 — Dashboard read model** | `/dashboard` shows derived Workspace Activation, separate User Guidance Progress, pending review/failures, next scheduled work, recent Content Pieces/Artifacts, and next-best CTA. | onboarding aggregate, assets, Channels, Content Pieces, Runs, Plans, Approvals, Deliveries, per-person guidance. | One read-only business projection plus separate user guidance state; partial failures render per card; no mutable readiness checklist. |
| **S5 — Brand Profile center** | `/brand` lets users inspect accepted Brand Profile, propose corrections/source refresh, review diffs, and change Interface/Content language. | existing Brand Source/Profile/revision/generation pipeline. | New revisions never rewrite accepted history; mixed RTL/LTR fields tested. |
| **S6 — Unified Library** | `/library/posts`, `/library/content`, `/library/media`, and `/library/prompts` provide the complete publishing, editable-creation, file, and prompt collections with shared pickers. | asset APIs, Content Pieces, Artifact projections, `/social/posts`, Prompt Library, Media Pool, storage quotas. | Resource identities remain distinct; no duplicated bytes or authority; search/filter URLs; origin/lineage/state visible. |
| **S7 — Complete content format system** | `/content` supports all observed formats through versioned Content Format Definitions, conflict-safe Content Piece Drafts/Revisions, transparent Model Policies, Candidate Outputs, Media Sets, Themes, Layout Preview, and production Render Proof: Slideshow, Wall of Text, Video Hook & Demo, Speaking Hook & Demo, Talking Head UGC, Green Screen Meme, Talking Head Green Screen, Product Spokesperson, Green Screen Mobile with App, Claymation, Character Swap, and Custom. | model discovery, Simple Studio, Content Pieces, Content Workflow Revisions/Runs, Managed Execution Quotes, production renderer, editor handoff. | Definitions drive UI/validation; no silent overwrite/model hiding/Arabic fallback; every format has complete input, preview/proof, progress, result, editing, retry, lineage, persistence, publishing handoff, and Arabic caption states. |
| **S8 — Calendar/publishing convergence** | unified `/calendar`, `/compose`, `/channels`; friendly summary counters, drag/reschedule, and canonical readiness/Approval/Delivery state. | current Social Hub, Publishing Settings registry, canonical publishing capabilities, Workspace commercial admission. | one publish authority; reschedule creates a Plan Revision and handles Approval/Delivery explicitly; admitted/reserved work survives later commercial changes; validation at client/release/provider boundaries; idempotent effects. |
| **S9 — Inspiration library** | `/inspiration` provides continuous rights-cleared discovery with daily ingestion, explainable ranking, search, niche/topic/format filters, populated and gated states, metrics freshness, item details, and explicit remix provenance. | Brand Profile, Content Preference Proposals, Library, Artifact lineage, format launcher. | “Why this appears,” source rights, timestamps, and scored signals visible; no direct duplication or silent Brand mutation; Arabic/MENA curation and every observed handoff included. |
| **S10 — Blitz review queue** | `/blitz` becomes a bounded resumable proposal queue with configured daily/manual replenishment, target capacity, format mix, Remix ratio, Brand/language constraints, execution mode, spend ceiling, source comparison, rationale, reject, edit, and Content Acceptance. | S5/S6/S7/S9 plus review-first publishing policy. | viewing never spends; admission stops at capacity/limits; Content Acceptance never publishes; actions are idempotent; the queue resumes; RTL gestures are explicit. |
| **S11 — Campaign Automations** | `/automations` provides the complete deep-linkable ten-step builder covering basics, format mix, Inspiration/Remix, Brand/language, Personas/media/themes, Channels, cadence/calendar, execution economics, Approval mode, and validation/activation/progress. | runtime Automations/Occurrences, Runs, Plans, Approvals, credits, budgets/quotas. | no durable empty draft on entry; immutable revisions and resumable autosave after substantive save; atomic launch; partial work/recovery visible; approval-first default with bounded policy option. |
| **S12 — Performance Analytics** | `/analytics` provides all observed date ranges, headline metrics, social-traffic-versus-posts, cumulative/daily charts, account/Platform/content-type breakdowns, distribution/inbox-direct views, Website Analytics, GEO reporting, drilldowns, durable per-source refresh, and Agent-readable queries. | Channel adapters, immutable Platform Metric Observations, Platform Metric Refresh, comparability registry, website measurement, runtime capability entrypoint. | exact definitions/source/unknown/freshness shown; only comparable metrics aggregate; sources update/fail independently; no causal claims from correlation. |
| **S13 — Product settings and global Copilot** | URL-addressable settings rendered as desktop sheet/mobile page for Account, Workspaces, Channels, Demo Videos, Remix themes/Media Sets, privacy/consent, storage/usage, budgets, credentials, language, timezone, notifications, and API/Agents; global Tasmeemai Copilot spans every route with bounded dismissible suggestions and Dashboard Next Action explanations. | Better Auth, canonical Workspace Assets, immutable Content Theme and Media Set revisions, consent-aware product telemetry, current social settings/Copilot, Studio Cockpits, agent pairing/tokens, shared capabilities. | role-aware sections; secrets never rendered; consent purposes never bleed into one another; conversations are Workspace-pinned; no repeated auto-open or hidden mutation/background work; all actions use authoritative capabilities. |
| **S14 — Persistent Influencers** | complete Synthetic and Consented Likeness Creator Persona creation, gated lifecycle, training, generation, reusable management, content sets, Channel connections, Blitz feed, suspension/expiry, and deletion. | Content Pieces, Artifacts, Workflows, credentials, usage, Library, consent/disclosure. | only active Personas generate; direct evidence for all Fastlane states plus explicit consent, abuse, disclosure, retention, and provider acceptance gates. |
| **S15 — Billing, credits, and referrals** | versioned Plan Definitions, Trial Grants, Workspace Subscription/Entitlements, fixed Managed Execution Quotes, separate allowance/purchased credit buckets, balance transitions, insufficient-credit handling, subscription transitions/grace, merchant portal, and cash-or-credit Refer & Earn lifecycle. | Usage Ledger evidence, Workspace-owned managed billing ledger, replaceable Merchant-of-Record Adapter, Entitlements, roles, Referral Recipient/payout ledger, fraud controls. | trial abuse cannot multiply by Workspace; quoted debit never rises; known failure releases/refunds; outcome-unknown holds visibly; expiring allowance is consumed first; BYOK/managed/referral ledgers never conflate; all money movements reconcile; MENA currencies/taxes and authored Arabic receipts are tested. |
| **S16 — Managed Channel Onboarding** | compliant counterpart to `/warmed-accounts`: discover, quote, pay, configure, review, provision, complete customer/partner actions, connect, monitor, cancel/refund, and support publish-ready Channels through Channel Onboarding Orders. | Channel registry, credential handoff, readiness, Workspace Subscription, Merchant-of-Record Adapter, bounded partner assignments, support operations. | full lifecycle/state recovery; Workspace authorization and Platform compliance evidenced; partners receive no reusable secrets or implicit publishing authority; no aged-identity sale or enforcement evasion. |
| **S17 — Guide, feedback, roadmap, and release lifecycle** | complete Guide center with versioned entries/tutorials/transcripts, trackable Feedback Cases and attachments, distinct public Roadmap Items/Release Notes, release notifications, Discord/community handoff, and support states. | product/version metadata, privacy-safe attachments, notifications, support workflow, S0 localization. | every parity route/CTA has current authored Arabic/English guidance; case resolution is observable; roadmap is non-binding; release facts are version-linked; accessibility and desktop/mobile coverage pass. |

No observed Fastlane user outcome is excluded from the destination. Deliberate non-copies are proprietary branding/copy/assets, literal aged-identity trafficking or enforcement evasion, and replacement of canonical capability/domain contracts with page-specific APIs.

## #13: What remains behind the evidence frontier?

Blocked by: #3, #4, #6, #7, #8, #9
Type: Research

### Question

Which unknown Fastlane states must be resolved before their dependent slices are implementation-ready?

### Answer

- Paid Inspiration result cards, filters, details, and remix handoff.
- Automation steps 2–10, list cards, editing, launch, progress, error, cancellation, and completion.
- Influencer creation/training forms, consent, progress, reuse, failure, and deletion.
- Populated Library item actions, post rescheduling, metrics refresh outcomes, media-set editing, and deletion.
- Calendar item details/dragging, populated status counter labels, failed/paused recovery, and timezone behavior.
- Populated Analytics tooltips, drilldowns, exports, metric freshness, and Website Analytics setup.
- Billing portal/plan details and paid API-key lifecycle.
- Desktop/tablet breakpoints between 390 px and the inspected desktop width.

Resolution rule: re-audit the dated Parity Baseline and obtain direct lawful evidence before implementing each dependent slice. Unknown behavior may be planned as an explicit research dependency, but never guessed into acceptance criteria or used to reduce committed scope; newly observed behavior enters explicit parity-change review. Research evidence must be sanitized: no account identity, Workspace data, referral code, token, proprietary generated content, or unrelated customer data; paid-state research uses a dedicated test Workspace and synthetic fixtures.

## #14: How is Arabic-first i18n implemented and proven?

Blocked by: #1
Type: Design

### Question

What concrete localization foundation prevents Arabic support from becoming scattered translated literals?

### Answer

- Every customer-facing string uses a stable semantic message key shared across client UI, server-rendered UI, validation and capability-error presentation, notifications, emails, billing, consent, security, publishing, Guide Entries, Roadmap Items, and Release Notes.
- Complete authored `ar` and `en` catalogs are release requirements. Arabic is the default Interface Language; runtime machine translation is prohibited for released copy. Machine assistance may draft text only before qualified human review.
- Migration extracts the shared shell, authentication, onboarding, common components, validation/capability-error vocabulary, email, and notifications in S0. Each later slice extracts its whole touched surface; a CI-tracked legacy-literal allowlist may only shrink and no new inline governed copy is permitted.
- Public indexable marketing, Guide, Roadmap, and Release Note pages use localized `/ar/...` and `/en/...` URLs with canonical and `hreflang` metadata. Authenticated resource routes remain locale-neutral so collaborators share one stable link.
- Locale resolution order is explicit current-session choice, signed-in person's Workspace-specific Interface Locale Preference, Workspace default, supported browser preference, then Arabic. A switch durably updates the preference and compatibility cookie without changing Content Language or Arabic Variety.
- Locale selection controls the root `lang` and `dir`, formatting for dates/times/numbers/currency/units, plural and gender rules, interpolation, and bidi isolation. Content Language and Arabic Variety remain independent of Interface Language.
- People may choose Arabic-Indic or Latin numerals and an optional Hijri companion display. Gregorian dates, UTC instants, IANA timezone, and explicit week-start/weekend settings remain scheduling authority; Arabic never implies a country or calendar.
- Layout code uses logical properties and direction-aware components. Media timelines, charts, numeric controls, handles, URLs, model identifiers, and other intrinsically LTR content follow explicit component rules instead of blanket mirroring.
- User-authored text uses `dir=auto`; interpolated mixed-direction content is bidi-isolated, with explicit LTR islands for URLs, email, handles, code, model/version IDs, phone numbers, and payment references.
- Shared Arabic-aware search normalizes tatweel, optional diacritics, common alef/ya variants, Unicode form, and whitespace for discovery while retaining originals. Filenames, handles, IDs, quoted searches, and audit evidence preserve exact semantics, and matching records why a normalized result appeared.
- Development diagnostics identify missing/unused keys and interpolation mismatches. CI fails for a required key absent from either catalog, raw key rendering, inline customer-facing copy in governed surfaces, or catalog schema drift.
- A production miss never renders a raw key: it falls back to the other authored locale, emits a high-severity Localization Incident with route/key/catalog version, and blocks the next release until fixed. Mandatory security and billing communication has reviewed bilingual emergency copy.
- Notification Deliveries pin recipient, semantic event, template/catalog version, delivery channel, and locale snapshot so retries remain deterministic; a digest adopts the latest preference only when its delivery instance is created.
- Tests cover catalog parity, server/client resolution, pseudolocalization, long strings, plural/gender cases, hostile mixed Arabic/Latin content, digits/calendars, keyboard/screen-reader order, and screenshot matrices for Arabic RTL and English LTR at desktop, tablet, and mobile widths.
- Every capability remains reachable on each viewport; responsive composition may change, but role, entitlement, state, direction, and deep-link behavior may not disappear.
- Unreliable-network behavior includes non-secret Client Draft Recovery, resumable uploads, visible offline/unsynced/conflict states, and idempotent paid/publishing actions. Credentials, payment authorization, publishing authorization, and sensitive consent evidence are never stored in browser recovery; server acceptance remains authoritative.
- The versioned Parity Matrix links every feature/state to its Arabic and English evidence. A surface cannot be marked complete because its English path works.

Decision: **S0 — Arabic-first i18n foundation** precedes the shared dashboard shell and every other parity slice. This is a first-class implementation item, not incidental translation work inside S1.

## #15: How do governance, agency collaboration, and customer control work?

Blocked by: #1, #5, #8, #10, #11, #14
Type: Design

### Question

Which authority, cross-client, approval, audit, safety, retention, bulk-operation, and portability contracts are required for full product parity without weakening Workspace isolation?

### Answer

- Built-in Owner, Admin, Billing Admin, Creator, Approver, Analyst, and Viewer Workspace Roles plus versioned Custom Roles are understandable Application Capability bundles. Exact resource grants, Approval Authority, policy, Entitlement, and state remain authoritative; no role alone grants Publishing Approval, credential use, or spend.
- Each client brand remains an independent Workspace. A Portfolio groups allowlisted Workspaces for agency navigation, reporting, templates, and Bulk Operations, but never merges or lends subscription, credits, resources, credentials, policies, ownership, or audit history. Every cross-Workspace action visibly pins and reauthorizes one target Workspace.
- A verified Review Guest may use a time-bounded, revocable, single-purpose link and step-up code to inspect, comment on, accept, approve, or reject one exact Render Proof or Plan Revision. The grant conveys no Workspace browsing, Channel administration, source-media access, or authority over later revisions.
- Versioned Approval Policies support single, any-of, sequential, quorum, separation-of-duty, deadline, escalation, and expiry behavior. Content Acceptance and Publishing Approval stay distinct, every decision pins policy and exact revision, and edits supersede decisions.
- Step-Up Authentication protects ownership transfer, Workspace Closure, authentication-factor changes, credential replacement, Agent Principal creation, unbounded spend, payout changes, exceptional credit/refund actions, and bulk public release without interrupting routine drafting.
- The customer-visible append-only Workspace Audit Trail covers membership/roles/grants, credentials, billing, Content Acceptance, Approval, Automation, generation, publishing, deletion, export, and support access under role-based filtering. Asynchronous encrypted exports expire and include a signed scope/hash/time/schema/omission manifest.
- Region-aware architecture precedes residency marketing. A Workspace pins a Data Region Policy only where infrastructure, contracts, subprocessors, backups, logging, and deletion are verified; incompatible provider/model routes are disclosed and excluded. Arabic, customer country, and Interface Language never infer region.
- Versioned Retention Classes independently govern recoverable drafts/media, published lineage, consent, security evidence, billing/tax evidence, provider diagnostics, and support attachments with defaults, legal floors, configurable bounds, holds, deletion receipts, and tombstones. Deletion explains immediate, delayed, and required retention.
- A Safety Decision records stable reason, policy version, safe explanation, affected intent, evidence reference, remediation, and appeal eligibility. A Safety Appeal cannot expose detection internals or create a bypass; even a successful appeal resumes only the exact intent after current revalidation.
- Every bulk form of a single-resource capability is a durable previewable Bulk Operation with explicit target set, Workspace, permissions, quote, dry-run, concurrency bound, per-item outcome, safe cancellation, and known-safe retry. Partial or ambiguous external outcomes never become atomic success or blind replay.
- Idempotent dry-run imports cover eligible media, content metadata, prompts, Brand sources, calendar plans, and supported Platform exports with provenance. Workspace Export covers canonical content/revisions, transferable media, captions, plans, observations, and authorized configuration; secrets, non-transferable licensed media, and legally retained evidence are explicitly omitted.

Decision: add **S2 — Workspace governance and trust** immediately after the shared shell so all later feature slices inherit one role, review, approval, audit, safety, retention, bulk-operation, region, and portability foundation.

## #16: What operational and release bar makes parity production-real?

Blocked by: #1, #5, #6, #8, #9, #11, #13, #14, #15
Type: Design

### Question

How must provider degradation, durable progress, performance, supported clients, accessibility, telemetry, rollout, incidents, recovery, contract migration, and final parity sign-off behave?

### Answer

- Tasmeemai never silently substitutes a model. A versioned Model Fallback Authorization may pre-authorize only operations compatible with requested capability, quality, Content Language, Arabic Variety, Data Region Policy, execution mode, and accepted quote; otherwise the Run waits for a decision. Every attempted and selected provider/model/version remains visible and fallback never raises the quote.
- Generation, ingestion, Persona training, metric refresh, Workspace Export, Bulk Operation, and publishing map their native lifecycles to a shared Durable Operation Status: queued, admitted, named running stage, waiting for user/provider/quota/time, blocked, cancelling, cancelled, succeeded, failed-known, or outcome-unknown. The projection includes honest confidence, timestamps, reservation/cost, safe reason, next action, and resumable events—never invented percentages.
- Experience Performance Budgets cover shell interaction, route transition, cached/uncached dashboard, search, preview, upload initiation, command acceptance, and status propagation under representative MENA and provider-region conditions. Provider execution latency is reported separately; Tasmeemai regressions block the affected slice.
- The Supported Client Matrix includes current and previous major Chrome, Safari, Firefox, and Edge; iOS Safari and Android Chrome; desktop, tablet, and 390 px mobile; touch, mouse, keyboard, zoom/reflow, and reduced motion. Unsupported clients receive an authored localized explanation. Native apps are outside this web parity baseline unless separately commissioned.
- WCAG 2.2 AA is release-blocking for Arabic RTL and English LTR: landmarks, focus/order/restoration, names, live status, contrast, zoom/reflow, motion, captions/transcripts, touch targets, and representative Arabic screen-reader output. Suggested AI alt text is labeled and editable.
- Product Telemetry Events are first-party, consent-aware, minimized, purpose/retention/region classified, and exclude prompts, generated content, media, secrets, and consent evidence. Product Experiments require owner, hypothesis, exposure record, guardrails, expiry, and outcome, and may never vary security, billing, Approval, safety, accessibility, retention, or audit semantics.
- Release Flags control cohorts only for complete vertical slices. Each has owner, eligibility, dependencies, telemetry, rollback, expiry, and Arabic/English evidence; neither flag state forks canonical capability behavior, exposes a dead route, bypasses policy, or waives parity cells.
- Localized in-product Service Incident state and a public component status history distinguish delayed, blocked, failed-known, and outcome-unknown work, including credit reservation and publishing risk, without exposing other customers or unsafe provider details.
- Encrypted, region-compatible backups have tested per-data-class Recovery Objectives, point-in-time recovery for canonical database state, immutable Artifact recovery where supported, and external-effect reconciliation after restore. Backup retention and deletion obey the same policy rather than becoming shadow archives.
- Contract Migrations use additive expand/migrate/contract changes, dry-run validation, resumable idempotent backfills, compatibility windows, progress/failure evidence, and rollback. Active Runs, accepted revisions, and scheduled intent keep pinned definitions and are never silently reinterpreted by deployment.
- The exact versioned Parity Matrix is the sole authority for the full-parity claim. Every route × feature × state × role × Entitlement × viewport × direction cell needs direct sanitized reference evidence, passing Tasmeemai evidence, deliberate-adaptation rationale where needed, and product, engineering, Arabic-language, accessibility, and security sign-off. Unknown, stale, skipped, or failing cells block the claim; later reference changes enter separate review.

Decision: add **S3 — Operational quality and release controls** before feature-heavy slices, then apply its progress, performance, client, accessibility, rollout, recovery, migration, and evidence gates to every subsequent slice.

## Recommended first implementation slice

Start with **S0 — Arabic-first i18n foundation**, then **S1 — Dashboard IA and shell**. S0 establishes the semantic-key, authored-catalog, formatting, directionality, fallback, validation, and test contracts every customer-facing parity slice must satisfy. S1 then changes the product from disconnected tools into one coherent Workspace while reusing existing routes and avoiding premature database or provider changes.

The complete S0 PR establishes the i18n runtime boundary, semantic key conventions, complete baseline `ar`/`en` catalogs, locale/direction resolution, server/client formatting helpers, missing-key enforcement, extraction/lint rules, and localization test harness. The complete S1 PR then covers the shared shell, `/dashboard` entry and shell states, nav metadata, compatibility adapters and redirects for legacy `/simple-studio/*` and `/social/*` deep links, authored shell keys, and shell tests. **S2 — Workspace governance and trust** and **S3 — Operational quality and release controls** follow before dependent product surfaces. Each replacement retires its duplicate legacy shell once parity passes. Trend ingestion, generation recipes, billing, and their domain tables belong to their already-committed dependency-ordered slices; their absence from S0/S1 is sequencing, not scope reduction.
