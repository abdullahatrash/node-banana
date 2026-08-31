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
| 9. Business classification | The next questionnaire asks for a B2B/B2C business model and one or more business categories to make content more relevant to the audience. | Live observation at [Fastlane onboarding](https://app.usefastlane.ai/onboarding) |
| 10. Signup intent and goals | The next questionnaire requires the user to choose why they signed up and what outcomes they expect from the platform. | Live observation at [Fastlane onboarding](https://app.usefastlane.ai/onboarding) |
| 11. Acquisition attribution | The final observed questionnaire requires one or more answers describing how the user heard about Fastlane. | Live observation at [Fastlane onboarding](https://app.usefastlane.ai/onboarding) |
| 12. Personalized social proof | After the seven questionnaire screens, Fastlane shows an interstitial with role-personalized testimonial framing and three linked posts before product entry. | Live observation at [Fastlane onboarding](https://app.usefastlane.ai/onboarding) |
| 13. Creation-mode education | The next interstitial explains Blitz Mode and Manual Creation, offers a tutorial for each, and presents the terminal **Continue to Dashboard** action. | Live observation at [Fastlane onboarding](https://app.usefastlane.ai/onboarding) |
| 14. First-value destination | **Continue to Dashboard** completes onboarding but routes directly to `/blitz`, where the new Workspace and an already-generated brand-specific content card are ready for review. | Live observation at [Fastlane Blitz](https://app.usefastlane.ai/blitz) |

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

### Fifth onboarding screen: business classification

The next state remains at `https://app.usefastlane.ai/onboarding`.

- heading **“What type of business do you run?”**;
- helper copy **“This helps us create content that resonates with your audience.”**;
- **Business model** with three choices: **B2B**, **B2C**, and **Both**;
- **Business category (select all that apply)** with eight choices: **E-commerce**, **SaaS**, **Agency**, **Services**, **Marketplace**, **Media/Content**, **Mobile app**, and **Other**;
- primary action **Continue**;
- secondary action **← Back**.

The **Continue** control is enabled before a selection, but submit-time validation and the behavior of **Other** have not been tested. No workspace-processing status is exposed on this screen.

Product interpretation for Node Banana: business model and categories belong to the Workspace Brand Profile because they describe the company rather than the current member. Persist the model as a normalized enum and categories as a bounded multi-select set, with separate user-authored detail only when **Other** requires it. These values may guide audience framing and content strategy but should not replace the richer product, audience, and positioning facts derived from Brand Sources.

### Sixth onboarding screen: signup intent and goals

The next state remains at `https://app.usefastlane.ai/onboarding`.

- heading **“Why did you sign up?”**;
- single-select prompt **Select one** with **I need marketing now**, **I need marketing in the future**, and **Just curious**;
- multi-select prompt **What do you expect from the platform? Select all that apply**;
- expected-outcome choices: **To save time on content creation**, **To get more views on social media**, **To drive traffic to my site**, **To generate revenue**, **To learn and become better at content marketing**, and **Other**;
- primary action **Continue**, initially disabled;
- secondary action **← Back**.

This is the first observed questionnaire where **Continue** is disabled before any selection. At least some intent data is therefore required, but whether both sections require an answer and the behavior of **Other** have not yet been tested. No workspace-processing status is exposed on this screen.

Product interpretation for Node Banana: signup urgency and expected outcomes are onboarding-goal data, not Brand Profile facts. Store them on the user's onboarding state or as explicit Workspace goals when the user is setting strategy. They can prioritize activation guidance, recommended first actions, and success metrics but must not appear as factual generated brand claims.

### Seventh onboarding screen: acquisition attribution

The next state remains at `https://app.usefastlane.ai/onboarding` and corresponds to the seventh position in the observed onboarding questionnaire sequence.

- heading **“How did you hear about us?”**;
- prompt **Select all that apply**;
- twelve choices: **X (Twitter)**, **LinkedIn**, **YouTube**, **TikTok**, **Instagram**, **Facebook**, **Podcast**, **Newsletter**, **Google**, **Reddit**, **Friend/Referral**, and **Other**;
- primary action **Continue**, initially disabled;
- secondary action **← Back**.

At least one acquisition source is required to enable progression, although the behavior of **Other** and the result of Continue have not yet been tested. No workspace-processing status is exposed on this screen.

Product interpretation for Node Banana: this is acquisition-attribution data for growth analytics. It belongs to the user's signup/onboarding record, not the Workspace Brand Profile and not the content-generation prompt. Because it offers no direct activation value to the user, Node Banana should consider making it skippable or collecting it after first value rather than blocking product entry solely for internal analytics.

### Post-questionnaire interstitial: personalized social proof

After the seven questionnaire positions, the route remains `https://app.usefastlane.ai/onboarding` and shows a testimonial interstitial rather than another data-collection screen.

- heading **“Loved by founders like you”**;
- helper copy **“See what others are saying about Fastlane”**;
- three testimonial cards linking to first-party-selected posts on X, attributed to **@Aevmorfop**, **@harjjotsinghh**, and **@H0ogie**;
- primary action **Continue**;
- secondary action **← Back**.

No data input or workspace-processing status is exposed. The phrase **“founders like you”** reflects the role selected on the earlier user-role step, proving that Fastlane applies onboarding answers immediately to personalize subsequent copy. The destination after Continue has not yet been observed.

Product interpretation for Node Banana: this is an activation/reassurance surface, not a domain-data step. If retained, use role- and region-relevant MENA proof with verifiable attribution, Arabic copy when the Interface Language is Arabic, and an obvious fast path forward. It should not delay first value merely to increase testimonial exposure.

### Onboarding completion gateway: creation modes

After continuing from social proof, the route remains `https://app.usefastlane.ai/onboarding` and introduces the product's two content-creation paths.

- heading **“Two ways to create content”**;
- tab **Blitz Mode**, initially selected, with tutorial description **“Generate and schedule content at scale with AI”** and action **Play Blitz Mode tutorial**;
- tab **Manual Creation**, with tutorial description **“Create and customize content step by step”** and action **Play Manual Creation tutorial**;
- terminal action **Continue to Dashboard**;
- top-level **Log out** remains available; no Back action is exposed.

Switching the two tabs changes the tutorial card. No evidence was observed that tab selection is persisted as a user preference. Neither tutorial was played during inspection, and the UI was restored to the default Blitz Mode tab. The destination after **Continue to Dashboard** has not yet been observed.

Product interpretation for Node Banana: this is product-orientation content, not profile data. The Arabic-first equivalent should clearly explain automated/high-volume creation versus guided/manual creation in the selected Interface Language, then let the user enter the relevant first-value path directly. Avoid forcing tutorial playback or storing a preference unless the user explicitly chooses a default workflow.

### Onboarding completion: first-value Blitz destination

Selecting **Continue to Dashboard** leaves onboarding and routes to `https://app.usefastlane.ai/blitz`, not `/home` or a generic dashboard.

- the Workspace switcher immediately shows the company name and uploaded/derived logo from onboarding;
- a roughly 14-day free-trial indicator is visible;
- the full product navigation becomes available, including Home, Blitz, Inspiration Library, Automations, AI Studio, Influencers, Content, Library, Calendar, Analytics, Warmed Accounts, Brand, Guide, and Settings;
- Blitz already contains a company-specific **Wall of Text** content card derived from the analyzed brand context;
- the card offers **Reject**, **Edit**, and **Approve** actions;
- **Why This Content?**, **Smart positioning**, **Configure Blitz**, and **Remixed From** affordances expose recommendation rationale, strategy/configuration, and source-performance context;
- a first-use hint with **Got it** teaches the Reject/Accept interaction;
- Fastlane Copilot and a global product-update panel are also present.

The attempted **Why This Content?** click did not change the visible state because the first-use hint appeared to be the active interaction layer. The hint was not dismissed, and no content was rejected, edited, or approved. The generated Brand Profile itself has not yet been inspected.

This closes the observed acquisition-to-first-value onboarding sequence. It confirms that Fastlane processes Brand Sources while questionnaire screens are being answered, then lands the user on already-generated, reviewable content instead of an empty dashboard. Product interpretation for Node Banana: preserve this parallelism and first-value principle, but label the terminal action with its real destination and provide a clear way to review/correct the Brand Profile before accepting generated content.

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
| Observed | `https://app.usefastlane.ai/onboarding` | Fifth setup state asks for one business-model choice and one or more business categories. Continue is initially enabled; no choice, validation behavior, or Other-field behavior was tested. |
| Observed | `https://app.usefastlane.ai/onboarding` | Sixth setup state asks for one signup-intent choice and one or more expected outcomes. Continue is initially disabled; exact enablement rules and Other-field behavior were not tested. |
| Observed | `https://app.usefastlane.ai/onboarding` | Seventh setup state asks for one or more acquisition sources. Continue is initially disabled; Other-field behavior and the destination after Continue have not been tested. |
| Observed | `https://app.usefastlane.ai/onboarding` | After the questionnaire, a no-input testimonial interstitial uses the selected Founder role in the heading “Loved by founders like you,” links to three X testimonials, and offers Continue or Back. |
| Observed | `https://app.usefastlane.ai/onboarding` | The next no-input interstitial explains Blitz Mode and Manual Creation through switchable tutorial cards and exposes Continue to Dashboard. Manual was inspected and the UI restored to Blitz; tutorials and the dashboard destination remain untested. |
| Observed | `https://app.usefastlane.ai/blitz` | Continue to Dashboard actually completes onboarding into Blitz. The Workspace identity is present and an already-generated brand-specific Wall of Text card offers Reject/Edit/Approve, proving that analysis and content preparation completed during onboarding. No content action or first-use-hint dismissal was performed. |

## Primary sources

- [Fastlane marketing site](https://www.usefastlane.ai/), accessed 2026-08-31.
- [Fastlane signup route](https://app.usefastlane.ai/signup), accessed 2026-08-31.
- [Fastlane public app bundle](https://app.usefastlane.ai/assets/AppRoot-D7yJQDoX.js), accessed 2026-08-31. The asset filename is content-hashed and may change after a deployment.
- Node Banana repository files linked inline above, inspected 2026-08-31.
