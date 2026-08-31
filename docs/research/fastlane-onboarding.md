# Fastlane onboarding reference

Date: 2026-08-31

## Research goal

Document Fastlane's acquisition-to-onboarding journey one verified step at a time so Node Banana can design an Arabic-first equivalent for the MENA region. This note deliberately stops at the first post-verification onboarding screen reached in the live walkthrough. It does not describe or infer any later screen.

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

No action on **Continue** has been recorded in this note, so the next screen and validation behavior remain unknown.

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

## Primary sources

- [Fastlane marketing site](https://www.usefastlane.ai/), accessed 2026-08-31.
- [Fastlane signup route](https://app.usefastlane.ai/signup), accessed 2026-08-31.
- [Fastlane public app bundle](https://app.usefastlane.ai/assets/AppRoot-D7yJQDoX.js), accessed 2026-08-31. The asset filename is content-hashed and may change after a deployment.
- Node Banana repository files linked inline above, inspected 2026-08-31.
