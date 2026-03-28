# Landing Home Page Design

**Date:** 2026-03-28

## Goal

Replace the current root page (`/`) redirect-to-studio behavior with a proper landing page that serves as the app's front door. The page shows a header with app navigation, auth controls, a hero section with illustration, and a footer.

## Routing Change

Remove the `redirect("/studio")` from `src/app/page.tsx`. The root page always renders the landing page regardless of auth state. Authenticated users see their name + sign out; unauthenticated users see sign in / sign up links.

## Components

### 1. AppSwitcher (shared, extracted)

**File:** `src/components/AppSwitcher.tsx`

Extract the `PILLAR_ITEMS` dropdown from `SocialAppSidebar.tsx` into a reusable component. Contains:

- AI Studio (`/studio`)
- Video Editor (`/editor/projects`)
- Social Hub (`/social`)
- Analytics (`/analytics`)
- Command Center (`/dashboard`) — below a separator

Trigger element: Logo icon + current app name (or "Node Banana" on the home page). Clicking opens a dropdown menu listing all pillar items.

Reuse existing `DropdownMenu` / `DropdownMenuItem` from `@/components/ui/dropdown-menu`.

**After extraction:** Update `SocialAppSidebar.tsx` to use the shared `AppSwitcher` instead of its inline dropdown.

### 2. HomeHeader

**File:** `src/components/HomeHeader.tsx`

A client component (`"use client"`) header for the landing page. No workflow state dependencies. Uses `authClient.useSession()` for auth state (same pattern as the existing `Header`).

**Layout:**
```
[Logo + "Node Banana" AppSwitcher dropdown] ---- [LanguageSwitcher] [Auth area]
```

- **Left:** `banana_icon.png` logo + "Node Banana" text, wrapped in the `AppSwitcher` dropdown
- **Right:**
  - `LanguageSwitcher` component (already exists)
  - Auth state (client component island):
    - Signed out: "Sign in" and "Sign up" links (to `/sign-in`, `/sign-up`)
    - Signed in: User display name or email + "Sign out" button

**Styling:** Dark theme matching existing app (`bg-neutral-900`, `border-neutral-800`), sticky top, same `h-11` height as studio Header.

### 3. HomeFooter

**File:** `src/components/HomeFooter.tsx`

Simple footer at the bottom of the page.

**Contents:**
- "Made by abodi" link to `https://x.com/abodiatrash`
- Discord support link to `https://discord.com/invite/89Nr6EKkTf`

**Styling:** Dark theme, `border-t border-neutral-800`, centered or end-aligned, small text.

### 4. Root Page (`src/app/page.tsx`)

Server component that renders:

```
<HomeHeader />
<main> (hero section) </main>
<HomeFooter />
```

**Hero section layout (flex row, centered vertically):**

- **Left side:**
  - Large heading: "Node Banana"
  - Subtitle: "Node-based AI image generation workflow editor"
  - CTA button: "Open Studio" linking to `/studio`
  - Secondary CTA: "Sign in" (only if not authenticated)

- **Right side:**
  - Hero image: `/hero-horse.png` (transparent PNG, origami horse with Arabic calligraphy)
  - Sized to ~400-500px, with responsive scaling

**Responsive:** On mobile, stack vertically (text on top, image below).

## Auth Handling

The root page (`page.tsx`) remains a server component. It uses `getServerAuthSession()` to check session and passes the session to `HomeHeader` as a prop for initial render. The `HomeHeader` is a client component that also uses `authClient.useSession()` for reactive auth state (sign out updates UI without page reload). No redirects from `/`.

## Files Changed

| File | Change |
|------|--------|
| `src/app/page.tsx` | Rewrite: remove redirect, render landing page |
| `src/components/AppSwitcher.tsx` | New: shared app navigation dropdown |
| `src/components/HomeHeader.tsx` | New: landing page header |
| `src/components/HomeFooter.tsx` | New: landing page footer |
| `src/components/social/SocialAppSidebar.tsx` | Update: use shared AppSwitcher |
| `public/hero-horse.png` | Renamed from `Adobe Express - file.png` |

## Out of Scope

- Marketing copy, feature lists, pricing
- Animation or scroll effects
- SEO metadata changes beyond what already exists
- Changes to `/studio`, `/social`, or other app pages
