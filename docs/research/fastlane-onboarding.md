# Fastlane onboarding reference

Date: 2026-08-31

## Research goal

Document Fastlane's acquisition-to-onboarding journey one verified step at a time so Node Banana can design an Arabic-first equivalent for the MENA region. The note advances only as the live walkthrough reaches each screen and does not infer unseen later screens.

## Evidence boundaries

- **Public, independently verified:** first-party pages or public client code inspected without an account.
- **Live observation:** behavior seen during the user's current walkthrough. These observations are useful product evidence but were not reproduced independently with the user's account.
- **Repository evidence:** Node Banana's checked-in source as of the date above.

## Source onboarding flow observed so far

| Step | Observed behavior | Evidence |
| --- | --- | --- |
| 1. Marketing CTA | The landing page's top CTA is **“Get Content for Free.”** Other CTAs on the same page use variants including “Get started for free” and “Claim your free content,” and point into the Fastlane app. | Public, independently verified: [Fastlane landing page](https://www.usefastlane.ai/) |
| 2. Signup | The signup screen offers Google signup or an email-and-password path. | Live observation at [Fastlane signup](https://app.usefastlane.ai/signup). The route itself and its Clerk signup component are independently verifiable in Fastlane's [public app bundle](https://app.usefastlane.ai/assets/AppRoot-D7yJQDoX.js), but the exact visible provider/form labels were not recoverable from the server-rendered HTML. |
| 3. Duplicate-email validation | Submitting an already-used email keeps the user on signup and shows the inline message: **“That email address is taken. Please try another.”** | Live observation at [Fastlane signup](https://app.usefastlane.ai/signup) |
| 4. Email verification | Submitting a new email/password successfully transitions to `/signup/verify-email-address`. | Live observation at [Fastlane email-verification route](https://app.usefastlane.ai/signup/verify-email-address) |
| 5. Initial profile setup | After verification, the user reaches `/onboarding`. The screen collects an optional company logo, full name, and company name, then offers **Continue**. | Live observation at [Fastlane onboarding](https://app.usefastlane.ai/onboarding) |
| 6. Brand-context source | The next onboarding state asks the user either to analyze a company website or provide a structured company description. | Live observation at [Fastlane onboarding](https://app.usefastlane.ai/onboarding), corroborated by the [public app bundle](https://app.usefastlane.ai/assets/AppRoot-D7yJQDoX.js) |
| 7. Company stage | While workspace preparation runs, the next questionnaire asks for team size and monthly revenue to tailor recommendations to the company's stage. | Live observation at [Fastlane onboarding](https://app.usefastlane.ai/onboarding) and the user-supplied screenshot dated 2026-08-31 |
| 8. User role | The next questionnaire asks which professional role best describes the user so Fastlane can customize their experience. | Live observation at [Fastlane onboarding](https://app.usefastlane.ai/onboarding) |

The public client bundle independently corroborates `/onboarding` as the signup component's successful-signup destination. Source: [Fastlane public app bundle](https://app.usefastlane.ai/assets/AppRoot-D7yJQDoX.js).

### First onboarding screen: exact live observation

At `https://app.usefastlane.ai/onboarding`, the observed screen contains:

- a top **Log out** action;
- the Fastlane logo;
- heading **“Welcome to Fastlane”**;
- helper copy **“Everything you enter here will be used directly across the platform.”**;
- **Company Logo (optional)** with an **Upload** action and the constraint **“PNG/JPG max 5MB”**;
- **Name**, placeholder **“Enter your full name”**;
- **Company Name**, placeholder **“Enter your company name”**;
- note **“Have multiple businesses? You can add more workspaces later in Settings > Workspaces.”**;
- primary action **Continue**.

Continuing from this screen leads to the brand-context source screen described below. Empty-field validation on this first screen was not tested.

### Second onboarding screen: website or description

The next state remains at `https://app.usefastlane.ai/onboarding` and offers two mutually exclusive sources for brand context.

**Website mode (default)**

- heading **“Analyze your website”**;
- helper copy **“We use this to understand your brand and generate relevant content.”**;
- selected tab **Website** and alternate tab **Use description instead**;
- **Company Website** input, prefilled with `https://` and placeholder `https://yourcompany.com`;
- primary action **Analyse Website**;
- secondary action **← Back**.

**Description mode**

- heading **“Tell us about your company”**;
- helper copy **“No website yet? Add the brand context we should use for content generation.”**;
- **Company Description** textarea with the prompt **“Describe what you sell, who it is for, why it matters, and the tone we should use.”**;
- structured starter text: **Product/service, Audience, Problem solved, Key benefits, Tone/positioning, Things to avoid**;
- minimum 20 characters and maximum 50,000 characters;
- disabled **Continue** action until the minimum is met;
- secondary action **← Back**.

After inspection, the live UI was restored to Website mode. No website or company description was submitted during this observation.

### What Fastlane does after submission

Fastlane's public client code exposes an asynchronous workspace-preparation state with these stages:

1. **Website / Description** — website mode tracks a `WEBSITE_SCRAPING` task; description mode marks the context as description-only.
2. **Profile** — `COMPANY_PROFILE_GENERATION` produces AI-powered company insights.
3. **Suggestions** — the UI waits for the first Blitz content card to be ready.
4. **Leads** — when engagement features are enabled, `REDDIT_LEADS_INITIAL` performs initial lead discovery.

The progress UI says **“Preparing your workspace”** and **“This usually takes 30–60 seconds.”** If website security blocks the scanner, Fastlane offers a recovery form where the user can paste homepage text or describe the company manually. The description-only path is processed with AI and does not require website scraping.

This confirms an asynchronous task pipeline from the client contract and progress states. The public client does not reveal whether the backend uses a particular job queue, worker framework, crawl depth, or scraping vendor, so those implementation details remain unknown.

### Node Banana language and persistence decisions

“Arabic-first” means Arabic is the default onboarding and content experience for the MENA audience; it does not mean Arabic-only. Node Banana must keep three concerns separate:

- **Interface Language** controls UI copy and direction.
- **Content Language** defaults generated output and is overridable per brief or generation.
- A Brand Source's detected language helps extraction but must not silently choose or change the requested Content Language.

The website or description pipeline should produce a versioned, schema-constrained **Brand Profile**, not an untyped LLM response. The server must parse and validate the structured output before persistence, reject or repair invalid output, and let the user review important claims. A minimal profile should distinguish product/service, audiences, problems, benefits, positioning, voice, prohibited claims/topics, supported content languages, and source provenance.

Repository gap: Node Banana currently stores `brandKit` as `Record<string, unknown>` JSON in both `workspaces` and `workspace_settings`. That is valid JSON storage but not a trustworthy domain contract, and the duplicated authority risks drift. The onboarding implementation should introduce one canonical, versioned Brand Profile schema and one source of truth rather than saving raw model JSON into either existing field without validation. Sources: [`src/lib/db/schema.ts`](../../src/lib/db/schema.ts#L317-L355), [`src/lib/studio/repository.ts`](../../src/lib/studio/repository.ts#L120-L166).

### Third onboarding screen: company stage

The next state remains at `https://app.usefastlane.ai/onboarding`. Website/profile processing continues in parallel while the user answers a segmentation questionnaire.

- heading **“Tell us about yourself”**;
- helper copy **“This helps us tailor recommendations to your stage.”**;
- **How big is your current team?** with six choices: **Just me**, **2–5**, **6–10**, **11–20**, **21–50**, and **50+**;
- **What is your current monthly revenue?** with six choices: **Pre-revenue**, **$1–$1,000**, **$1,000–$10k**, **$10k–$50k**, **$50k–$500k**, and **$500k+**;
- primary action **Continue**;
- secondary action **Change website or description**;
- a visual seven-position progress indicator with the third position active;
- a floating **Preparing workspace** status showing **Website** and **Profile** stages.

The **Continue** control is enabled before any selection, but its submit-time validation and whether either question is optional have not been tested. No team-size or revenue answer was selected during inspection.

Product interpretation for Node Banana: these answers describe business maturity and should be stored as workspace/company segmentation data. They can tune onboarding recommendations, suggested publishing cadence, and education level, but should not be treated as factual brand-copy inputs unless the user explicitly wants revenue or team size mentioned in generated content.

### Fourth onboarding screen: user role

The next state remains at `https://app.usefastlane.ai/onboarding`.

- heading **“What describes you best?”**;
- helper copy **“We'll customize your experience based on your role.”**;
- label **Select your role**;
- nine choices: **Founder**, **Social Media Manager**, **Marketing Manager**, **Agency Owner**, **Freelancer**, **Product Manager**, **Content Creator**, **Growth Manager**, and **Other**;
- primary action **Continue**;
- secondary action **← Back**.

The **Continue** control is enabled before a selection, but submit-time validation and whether the question can be skipped have not been tested. No workspace-processing status is exposed on this screen.

Product interpretation for Node Banana: this answer belongs to the individual user or their Workspace membership, not the Brand Profile. Multiple people in one Workspace can have different professional roles. The value may personalize navigation, education, recommendations, and default workflows without changing the brand's factual identity or generated claims.

### Related first-party product framing

Fastlane's public “How it works” sequence is: **Enter your website → Blitz mode → Fill up your calendar → Track your growth.** This describes the product journey, not the verified account-onboarding screen sequence. Source: [Fastlane landing page](https://www.usefastlane.ai/).

## Existing Node Banana auth and onboarding state

### Current acquisition entry

Node Banana's marketing page sends all signup CTAs to `/sign-up`, using the configured app origin when the marketing and product origins are split. Sources: [`src/app/page.tsx`](../../src/app/page.tsx#L19-L28), [`src/lib/site-routing.ts`](../../src/lib/site-routing.ts#L77-L105).

### Current signup experience

- `/sign-up` is a single client-side form with **Name**, **Email**, and **Password** fields. It uses `authClient.signUp.email(...)`, renders errors inline, and redirects successful signups directly to `/simple-studio/images`. Source: [`src/app/sign-up/page.tsx`](../../src/app/sign-up/page.tsx#L21-L59).
- The auth page includes the language switcher, but its form headings, labels, placeholder, error fallback, and button copy are hard-coded in English. Sources: [`src/app/sign-up/page.tsx`](../../src/app/sign-up/page.tsx#L62-L131), [`src/components/LanguageSwitcher.tsx`](../../src/components/LanguageSwitcher.tsx#L8-L22).
- Arabic is the default locale when no explicit English locale cookie exists, and it maps to RTL direction. Source: [`src/lib/locale.ts`](../../src/lib/locale.ts#L4-L15).

### Current auth capabilities

- Better Auth email/password signup is enabled, but `requireEmailVerification` is explicitly `false`. Therefore Node Banana has no required verification checkpoint comparable to the observed Fastlane step. Source: [`src/lib/auth/server.ts`](../../src/lib/auth/server.ts#L128-L140).
- Google and GitHub OAuth are supported behind server feature flags, and both are off by default in documented setup. The current `/sign-up` UI does not expose either provider. Sources: [`src/lib/auth/features.ts`](../../src/lib/auth/features.ts#L29-L87), [`README.md`](../../README.md#L54-L68), [`src/app/sign-up/page.tsx`](../../src/app/sign-up/page.tsx#L37-L54).
- When a database-backed user is created, a server hook ensures that user has a personal workspace. Sources: [`src/lib/auth/server.ts`](../../src/lib/auth/server.ts#L141-L153), [`src/lib/studio/repository.ts`](../../src/lib/studio/repository.ts#L324-L342).
- Authenticated visits to `/sign-up` also redirect directly to `/simple-studio/images`; protected Simple Studio and Social surfaces send signed-out users to sign-in. Sources: [`src/app/sign-up/page.tsx`](../../src/app/sign-up/page.tsx#L31-L35), [`src/app/simple-studio/layout.tsx`](../../src/app/simple-studio/layout.tsx#L11-L17), [`src/app/social/layout.tsx`](../../src/app/social/layout.tsx#L11-L17).

### Current gap relative to the observed Fastlane flow

Node Banana currently has the marketing-to-signup link and email/password account creation, but it does not yet have the observed Fastlane-style sequence:

1. Google option presented alongside email/password on the signup page.
2. Required email verification before product entry.
3. A dedicated post-auth onboarding route/state before the main creation surface.
4. Fully localized Arabic-first auth copy rather than direction switching around English form copy.
5. An initial profile/workspace setup step that collects the user's name, company identity, and optional logo before product entry.

This is a factual gap inventory, not yet an implementation specification. The onboarding questions, data model, screen count, completion state, skip policy, and destination should be decided only after the live walkthrough reaches those screens.

## Ongoing live observations

Append new observations here in sequence. Record the URL, exact visible copy, available actions, validation behavior, whether a step is optional, and the result of each action.

### Observation log

| Status | URL | Observation |
| --- | --- | --- |
| Observed | `https://app.usefastlane.ai/signup` | Signup offers Google or email/password. A duplicate email produces the inline error “That email address is taken. Please try another.” |
| Observed | `https://app.usefastlane.ai/signup/verify-email-address` | A successful new-email submission reached this route. Screen copy and actions have not yet been recorded. |
| Observed | `https://app.usefastlane.ai/onboarding` | First setup screen: Log out; Fastlane logo; welcome/helper copy; optional company-logo upload (PNG/JPG, max 5MB); name; company name; multi-workspace note; Continue. The result of Continue has not yet been observed. |
| Observed | `https://app.usefastlane.ai/onboarding` | Second setup state offers Website analysis or a manual Company Description. Website mode was restored after inspecting both paths; nothing was submitted. Public client code confirms async website/description processing, company-profile generation, first suggestions, and optional lead discovery. |
| Observed | `https://app.usefastlane.ai/onboarding` | Third setup state asks for team-size and monthly-revenue bands while Website/Profile preparation runs in parallel. Continue is initially enabled; no answer or validation behavior was tested. |
| Observed | `https://app.usefastlane.ai/onboarding` | Fourth setup state asks the user's professional role from nine choices. Continue is initially enabled, no role was selected during inspection, and the earlier workspace-processing status is no longer visible. |

## Primary sources

- [Fastlane marketing site](https://www.usefastlane.ai/), accessed 2026-08-31.
- [Fastlane signup route](https://app.usefastlane.ai/signup), accessed 2026-08-31.
- [Fastlane public app bundle](https://app.usefastlane.ai/assets/AppRoot-D7yJQDoX.js), accessed 2026-08-31. The asset filename is content-hashed and may change after a deployment.
- Node Banana repository files linked inline above, inspected 2026-08-31.
