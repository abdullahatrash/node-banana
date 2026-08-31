# Arabic-First Onboarding Implementation Plan

**Goal:** Implement a secure, resumable onboarding journey inspired by Fastlane: verified signup, workspace identity, website-or-description brand discovery, a short personalization questionnaire, asynchronous Brand Profile generation, and a first-value handoff. Arabic is the default interface and content language, while English remains fully supported and output language remains independently configurable.

**Research:** [`docs/research/fastlane-onboarding.md`](../../research/fastlane-onboarding.md)

**Architecture:** Add a deep `onboarding` Module whose public Interface is `getSnapshot()` plus `execute(command)`. The Module owns step ordering, validation, authorization, idempotency, and state transitions. Postgres, website extraction, structured LLM generation, email delivery, and Vercel Workflow are internal Adapters behind narrow Seams. The browser never writes directly to workspace, Brand Profile, or analysis-run tables.

**Stack:** Next.js 16 App Router, Better Auth 1.5, Postgres + Drizzle, Zod 4, AI SDK 6 structured output, Vercel Workflow, Zustand only for transient client UI, Vitest + Testing Library.

---

## Product contract

### Journey

1. Marketing CTA opens `/sign-up` on the app origin.
2. Email/password signup sends a verification email and opens `/verify-email`; Google signup follows the provider's verified-email lifecycle.
3. After verification, the user is routed to `/onboarding`.
4. Identity step collects the company name and optional logo. The current signup name is prefilled and editable.
5. Brand Source step accepts either a public website URL or a 20–50,000-character company description.
6. Submitting the source starts durable background analysis while the user continues the questionnaire.
7. Questionnaire steps collect company stage, user role, business classification, goals, and optional acquisition attribution.
8. The progress card exposes real stages: source, profile, and first suggestion. It must never show invented progress.
9. The user reviews the generated Brand Profile, corrects material facts, and accepts it.
10. Education/social-proof content is locally authored and personalized by role. It is not a prerequisite for analysis completion.
11. Completion opens a minimal `/blitz` activation shell containing the first generated suggestion. Building the full Blitz product is outside this plan.

Every step is autosaved on submission and resumable on another device. Back navigation does not discard completed answers. Refreshing or retrying the Brand Source creates a new analysis run and never silently overwrites an accepted Brand Profile.

### Intentional differences from Fastlane

- Do not reveal whether an email is already registered. Better Auth's email-enumeration protection takes precedence over Fastlane's inline duplicate-email message.
- Acquisition attribution is skippable because it serves internal analytics rather than user activation.
- The Brand Profile must be reviewed before it becomes active; generated facts are not accepted silently.
- Website extraction is limited and security-hardened. The first release reads the submitted public page and a small allowlisted set of same-origin, high-signal pages rather than acting as a general crawler.

### Language contract

- `Interface Language`: user preference; `ar` by default, `en` supported; controls copy and RTL/LTR.
- `Content Language`: workspace preference expressed as a BCP-47 tag; `ar` by default; overridable for every later generation.
- `Brand Source Language`: detected metadata only. It must not change either preference.
- The Brand Profile summary is generated in the selected Content Language, while source evidence preserves its original language.

---

## Domain model and authority

### Canonical records

| Record | Ownership | Purpose |
| --- | --- | --- |
| `user_preferences` | User | Interface language and future per-user experience preferences. |
| `onboarding_sessions` | User, optionally linked to Workspace | Current step, status, validated `OnboardingAnswersV1`, optimistic revision, and completion timestamps. |
| `brand_sources` | Workspace | Immutable website/description source revisions, normalized provenance, detected language, hashes, and bounded extracted text. |
| `brand_analysis_runs` | Workspace | Canonical asynchronous resource with stage, status, source revision, errors, retry lineage, and idempotency key. It is not a generic job table. |
| `brand_profiles` | Workspace | Immutable, schema-versioned Brand Profile revisions with `draft`, `active`, or `superseded` status. Only one active revision per Workspace. |
| `onboarding_activation_artifacts` | Workspace | Versioned first suggestion used by the temporary `/blitz` handoff. |

Add `workspace_settings.default_content_language`, initially `ar`. Keep both legacy `brand_kit` columns readable during rollout, but stop writing new onboarding data to them. A later migration can remove them after all consumers use `brand_profiles`.

`BrandProfileV1` is a Zod schema and TypeScript type containing:

- identity: company name and optional logo asset ID;
- offering: products/services and concise core identity;
- audiences: named segments, descriptions, and weights summing to 100;
- problems, benefits, differentiators, mission, positioning, and owned space;
- business model and bounded categories;
- voice: tone descriptors, up to ten `do` items, and up to ten `doNot` items;
- prohibited claims/topics and uncertainty flags;
- competitors with optional canonical URLs;
- content angles;
- language metadata and source provenance for material claims.

JSONB is storage, not validation. Parse `OnboardingAnswersV1`, `BrandProfileV1`, and `ActivationArtifactV1` on every write and every database read. Reject unknown schema versions. Never persist raw model text as an active profile.

### State machine

`not_started -> identity -> brand_source -> questionnaire -> review -> education -> ready -> completed`

Analysis runs independently:

`queued -> fetching_source -> extracting -> generating_profile -> generating_first_value -> ready`

Terminal run states are `ready`, `failed_retryable`, and `failed_terminal`. Commands include `expectedRevision` and `idempotencyKey`; stale writes return `409`, and replayed commands return the original snapshot.

---

## Module design

### Public Interface

Create `src/lib/onboarding/service.ts` with only:

```ts
interface OnboardingService {
  getSnapshot(input: { userId: string }): Promise<OnboardingSnapshot>;
  execute(input: {
    userId: string;
    expectedRevision: number;
    idempotencyKey: string;
    command: OnboardingCommand;
  }): Promise<OnboardingSnapshot>;
}
```

`OnboardingCommand` is a discriminated union: `save_identity`, `set_brand_source`, `save_company_stage`, `save_role`, `save_business_classification`, `save_goals`, `save_attribution`, `accept_brand_profile`, `retry_analysis`, and `complete`.

The HTTP Adapter maps `GET /api/onboarding` to `getSnapshot` and `POST /api/onboarding` to `execute`. Step components know this transport only; they do not know database tables or workflow functions.

### Internal Seams and Adapters

- `OnboardingRepository`: Postgres production Adapter and in-memory test Adapter.
- `BrandSourceReader`: description Adapter and hardened HTTP website Adapter.
- `BrandProfileGenerator`: AI SDK Adapter using `Output.object({ schema: BrandProfileV1Schema })`; fake deterministic Adapter for tests.
- `OnboardingQueue`: Vercel Workflow Adapter; immediate fake Adapter for tests.
- `EmailSender`: provider-neutral Interface; Resend Adapter is the recommended production default, console Adapter only in local development.
- `Clock`, `IdGenerator`, and `DnsResolver`: injected where deterministic tests or SSRF checks need them.

The existing generic `/api/llm` endpoint returns text and does not provide the required schema guarantee. Reuse its model/provider configuration ideas, but do not call it or parse arbitrary fenced JSON. The new generator Adapter uses the already-installed AI SDK's structured `Output.object` support and validates again before persistence.

---

## Security and privacy requirements

- Website URLs allow only `http` and `https`, normalize IDNs, strip credentials/fragments, and cap URL length.
- Resolve every hostname before the request and again after each redirect. Block loopback, private, carrier-grade NAT, link-local, multicast, IPv6 local ranges, and cloud metadata destinations.
- Maximum 3 redirects, 10-second request timeout, 2 MB per response, 4 pages, and 6 MB total extracted input. Accept HTML/plain text only.
- Crawl only the submitted origin. Candidate links are limited to the home page plus recognizable About, Product/Services, and Pricing paths. Respect robots directives and use an identifiable user agent.
- Remove scripts, styles, navigation repetition, forms, hidden content, and prompt-like page instructions. Website text is untrusted evidence, never instructions to the model.
- The system prompt states that source text cannot alter the task or schema. Every extracted assertion is treated as unverified until the user accepts it.
- Store a content hash, fetch time, final URL, detected language, and bounded cleaned text. Do not store response headers, cookies, analytics IDs, or arbitrary binary content.
- Redact source text and model prompts from normal logs. Log IDs, stages, timings, byte counts, model, token usage, and stable error codes.
- All onboarding and Brand Profile access is scoped through the authenticated user and Workspace membership. The workflow reloads authorization context server-side and never trusts browser-supplied Workspace IDs.

---

## Implementation tasks

### Task 1: Contracts and state transitions

**Create:**

- `src/lib/onboarding/contracts.ts`
- `src/lib/onboarding/schemas.ts`
- `src/lib/onboarding/state-machine.ts`
- `src/lib/onboarding/errors.ts`
- `src/lib/onboarding/__tests__/schemas.test.ts`
- `src/lib/onboarding/__tests__/state-machine.test.ts`

**Work:**

- [ ] Define stable enums/sets for every observed questionnaire choice, using machine codes independent of Arabic/English labels.
- [ ] Define `OnboardingAnswersV1`, `BrandProfileV1`, `ActivationArtifactV1`, snapshots, commands, run stages, and typed domain errors.
- [ ] Enforce description length, segment weight total, tone list limits, URL shape, required goal selections, and valid transitions.
- [ ] Test Arabic text, English text, mixed-script inputs, optional attribution, stale transitions, and invalid schema versions.

**Commit:** `feat(onboarding): define versioned onboarding contracts`

### Task 2: Postgres authority and compatibility migration

**Modify/Create:**

- `src/lib/db/schema.ts`
- generated `drizzle/0053_*.sql` and matching metadata
- `scripts/db-backfill-onboarding.mjs`
- `src/lib/onboarding/repository.ts`
- `src/lib/onboarding/postgres-repository.ts`
- `src/lib/onboarding/memory-repository.ts`
- repository and migration-contract tests under `src/lib/onboarding/__tests__/`

**Work:**

- [ ] Add the six canonical records and `workspace_settings.default_content_language` described above.
- [ ] Add uniqueness for one user session, run idempotency, source revision, profile revision, and one active profile per Workspace.
- [ ] Make profile activation transactional: activate the accepted draft and supersede the previous active revision atomically.
- [ ] Add optimistic revision checks and command receipts so retrying a request cannot create duplicate workspaces or runs.
- [ ] Backfill existing users with Workspace membership as `completed_legacy`; do not force them through onboarding.
- [ ] Read legacy `brand_kit` only as a compatibility projection when no active Brand Profile exists. Do not dual-write.

**Commit:** `feat(onboarding): add persistent onboarding and brand profile authority`

### Task 3: Email verification and post-auth routing

**Modify/Create:**

- `src/lib/auth/server.ts`
- `src/lib/auth/email-sender.ts`
- `src/lib/auth/resend-email-sender.ts`
- `src/lib/auth/post-auth-destination.ts`
- `src/app/sign-up/page.tsx`
- `src/app/sign-in/page.tsx`
- `src/app/verify-email/page.tsx`
- auth tests under `src/lib/auth/__tests__/` and page tests

**Work:**

- [ ] Configure Better Auth `emailVerification.sendVerificationEmail`, `sendOnSignUp: true`, `emailAndPassword.requireEmailVerification: true`, and `autoSignInAfterVerification: true`.
- [ ] Use `/onboarding` as the verified callback; provide resend, cooldown, expired-link, already-verified, and sign-out states.
- [ ] Send email through the `EmailSender` Seam using the platform request-lifetime mechanism; do not block responses on delivery.
- [ ] Keep the current required Name field during signup, then prefill it during onboarding. This avoids fake Better Auth names while keeping the observed onboarding editing experience.
- [ ] Centralize the destination decision: unverified -> `/verify-email`; verified incomplete -> `/onboarding`; complete -> safe requested product path or `/blitz`.
- [ ] Remove workspace provisioning from the Better Auth user-created hook. Provision once, transactionally, from `save_identity` after verification.
- [ ] Preserve enumeration-safe signup responses even though the reference product reveals duplicate emails.

**Environment:** add `RESEND_API_KEY`, `AUTH_FROM_EMAIL`, and a feature flag allowing email delivery to stay console-only outside production.

**Commit:** `feat(auth): require verified email before onboarding`

### Task 4: Onboarding service and workspace lifecycle

**Create/Modify:**

- `src/lib/onboarding/service.ts`
- `src/lib/onboarding/production.ts`
- `src/lib/onboarding/access.ts`
- `src/lib/studio/repository.ts`
- `src/app/api/studio/workspaces/route.ts`
- service tests with the in-memory repository

**Work:**

- [ ] Implement `getSnapshot` and `execute` as the only application Interface.
- [ ] Make `save_identity` create the Workspace, Workspace membership, Better Auth organization mapping, storage limit, onboarding link, and preferences in one idempotent transaction.
- [ ] Stop `GET /api/studio/workspaces` from auto-provisioning for new incomplete users; retain a compatibility path for `completed_legacy` users.
- [ ] Separate user-owned role/attribution/goals from Workspace-owned company facts.
- [ ] Add `requireOnboardingComplete` and `resolvePostAuthDestination` helpers without teaching layouts about onboarding tables.
- [ ] Verify unauthorized, unverified, concurrent, replayed, out-of-order, and resumed command behavior.

**Commit:** `feat(onboarding): implement resumable onboarding service`

### Task 5: Safe Brand Source ingestion

**Create:**

- `src/lib/onboarding/brand-source/ports.ts`
- `src/lib/onboarding/brand-source/url-policy.ts`
- `src/lib/onboarding/brand-source/website-adapter.ts`
- `src/lib/onboarding/brand-source/description-adapter.ts`
- `src/lib/onboarding/brand-source/extract.ts`
- tests and HTML fixtures under `src/lib/onboarding/brand-source/__tests__/`

**Work:**

- [ ] Implement all SSRF, redirect, size, timeout, MIME, crawl-depth, and logging limits above.
- [ ] Add a production HTML parser dependency rather than regex-based extraction.
- [ ] Rank only same-origin high-signal links and make the total crawl deterministic and bounded.
- [ ] Detect source language as metadata; never use it to silently update Content Language.
- [ ] Treat inaccessible sites as recoverable and return the manual-description option with the original answers intact.
- [ ] Test private IPv4/IPv6, DNS rebinding, redirect escape, oversized content, unsupported MIME, prompt injection text, Arabic HTML, English HTML, and description fallback.

**Commit:** `feat(onboarding): add hardened brand source ingestion`

### Task 6: Structured Brand Profile generation

**Create:**

- `src/lib/onboarding/brand-profile/ports.ts`
- `src/lib/onboarding/brand-profile/prompt.ts`
- `src/lib/onboarding/brand-profile/ai-sdk-adapter.ts`
- `src/lib/onboarding/brand-profile/evidence.ts`
- tests under `src/lib/onboarding/brand-profile/__tests__/`

**Work:**

- [ ] Build a provider-neutral generator Adapter with the selected model supplied by configuration.
- [ ] Use a fixed system instruction plus AI SDK `Output.object` and `BrandProfileV1Schema` for constrained output.
- [ ] Include requested Content Language explicitly, independent of source language and Interface Language.
- [ ] Require uncertainty markers and evidence references; prevent the model from inventing prices, customer counts, awards, guarantees, revenue, or regulated claims.
- [ ] Validate output a second time. Allow one schema-repair attempt using validation errors; otherwise fail with a stable retryable code and persist no profile.
- [ ] Generate the activation suggestion only from the validated draft profile.
- [ ] Test valid Arabic/English output, malicious source text, missing evidence, bad weights, extra keys, truncated output, repair success, and terminal failure.

**Commit:** `feat(onboarding): generate validated multilingual brand profiles`

### Task 7: Durable analysis workflow

**Create:**

- `workflows/onboarding-brand-analysis.ts`
- `src/lib/onboarding/queue.ts`
- `src/lib/onboarding/durable-queue.ts`
- workflow and queue tests

**Work:**

- [ ] Start the workflow only after the source revision and outbox/dispatch intent commit.
- [ ] Implement retriable `use step` stages: load run, fetch/read source, extract, generate draft profile, generate activation artifact, finalize.
- [ ] Make every step idempotent and safe after process death. A retry must reuse the same source/run and must not create duplicate profile revisions.
- [ ] Persist actual stage transitions before the UI reports them.
- [ ] Classify blocked website, invalid source, rate limit, provider outage, invalid model output, and internal invariant failures into stable user-facing recovery states.
- [ ] Add a retry command that creates a new run linked to its predecessor rather than mutating terminal history.

**Commit:** `feat(onboarding): orchestrate durable workspace preparation`

### Task 8: Arabic-first onboarding UI

**Create/Modify:**

- `src/app/onboarding/layout.tsx`
- `src/app/onboarding/page.tsx`
- `src/components/onboarding/OnboardingFlow.tsx`
- `src/components/onboarding/steps/*.tsx`
- `src/components/onboarding/PreparationStatus.tsx`
- `src/components/onboarding/BrandProfileReview.tsx`
- `src/components/onboarding/copy.ts`
- `src/components/onboarding/__tests__/*.test.tsx`
- existing locale/preferences integration

**Work:**

- [ ] Render Arabic copy and RTL by default, with an always-available English switch. Keep option codes independent of translated labels.
- [ ] Fetch the server snapshot on entry; client state is a draft cache only, never the source of truth.
- [ ] Implement identity/logo, source toggle, questionnaire, progress, review, education, failure, retry, and resume states.
- [ ] Reuse the existing workspace asset upload path for the optional logo after `save_identity` creates the Workspace; validate PNG/JPEG and 5 MB in both browser and server.
- [ ] Poll with backoff or use the existing server-supported progress mechanism; stop when the tab is hidden and resume on focus.
- [ ] Make loading/error copy truthful, accessible, and direction-safe. Restore focus on step changes and announce background progress with a polite live region.
- [ ] Test RTL order, LTR order, keyboard use, translations, validation, double submit, refresh resume, back navigation, failed analysis, and profile correction.

**Commit:** `feat(onboarding): build Arabic-first resumable onboarding UI`

### Task 9: Product gates, routing, and first-value handoff

**Create/Modify:**

- `src/app/blitz/page.tsx`
- `src/app/simple-studio/layout.tsx`
- `src/app/social/layout.tsx`
- `src/app/studio/layout.tsx`
- `src/app/agents/layout.tsx`
- `src/lib/site-routing.ts`
- `src/proxy.ts`
- relevant routing/layout tests

**Work:**

- [ ] Add `/verify-email`, `/onboarding`, and `/blitz` to the product-origin routing policy and proxy matcher.
- [ ] Apply the centralized onboarding gate to authenticated product layouts and protected API wrappers. Avoid redirect loops for verification/onboarding routes.
- [ ] Change the app-origin `/` default to the centralized post-auth destination rather than hardcoding `/simple-studio/images`.
- [ ] Render the activation artifact in a minimal `/blitz` shell with source/profile provenance and a CTA into the existing creation tools.
- [ ] Define a stable handoff contract so the later full Blitz feature can replace the shell without changing onboarding.
- [ ] Test marketing/app origin redirects, safe `next` paths, unverified access, incomplete direct-route access, legacy users, completed users, and loop prevention.

**Commit:** `feat(onboarding): enforce activation gates and add first-value handoff`

### Task 10: Observability, rollout, and acceptance

**Create/Modify:**

- analytics event definitions and tests
- `.env.example` and deployment documentation
- rollout/backfill runbook
- `docs/research/fastlane-onboarding.md` with links to the resulting implementation

**Work:**

- [ ] Emit privacy-safe events: signup submitted, verification sent/completed, step viewed/completed, source type, analysis stage/duration/failure code, profile accepted/edited, first-value viewed, onboarding completed.
- [ ] Add dashboards/queries for verification completion, step drop-off, time to draft profile, analysis failure by code, time to first value, and Arabic-versus-English selection. Never send description/source body as analytics properties.
- [ ] Gate new onboarding by server-side cohort flag. Backfill legacy completion before enabling gates.
- [ ] Roll out in order: internal accounts, new test cohort, 10%, 50%, 100%. Keep a kill switch that bypasses the flow for new signups without deleting saved state.
- [ ] Run focused tests after every task, then `pnpm test:run`, `pnpm typecheck`, `pnpm lint`, `pnpm build`, migration on a disposable Postgres database, and a manual Arabic/English browser smoke test.
- [ ] Verify the acceptance checklist below and record screenshots of every state.

**Commit:** `chore(onboarding): add rollout telemetry and acceptance coverage`

---

## Acceptance checklist

- [ ] A new email/password user cannot obtain a product session before verification.
- [ ] A verified new user resumes at the last committed onboarding step on any device.
- [ ] Arabic is the initial UI/content language; switching to English changes direction and copy without changing the Brand Source.
- [ ] Website and description paths both create validated Brand Profiles.
- [ ] A blocked or unsafe website produces a recoverable description fallback and no outbound request to a private destination.
- [ ] Questionnaire answers never become public brand claims unless mapped into a reviewed Brand Profile field.
- [ ] Progress reflects persisted workflow stages and survives refresh/process restart.
- [ ] Invalid or malicious LLM output cannot become an active Brand Profile.
- [ ] Accepting a draft is transactional, preserves history, and does not overwrite a later user edit.
- [ ] A completed user reaches a real first suggestion at `/blitz`.
- [ ] Existing users are marked `completed_legacy` and retain access.
- [ ] Direct product routes and APIs reject incomplete onboarding without redirect loops.
- [ ] Normal logs and analytics contain no website body, company description, email token, or raw prompt.

## Suggested delivery slices

1. **Foundation PR:** Tasks 1–4. Verified auth, state machine, schema, and resumable commands with a fake queue.
2. **Intelligence PR:** Tasks 5–7. Secure source ingestion, structured Brand Profile generation, and durable execution.
3. **Experience PR:** Tasks 8–9. Arabic/English UI, product gates, review, and first-value shell.
4. **Rollout PR:** Task 10. Telemetry, backfill, cohort rollout, documentation, and full acceptance evidence.

Do not merge an Experience PR that calls a real website fetch or LLM without the security and schema-validation work from the Intelligence PR. Do not enable product gates until the legacy backfill is deployed and verified.
