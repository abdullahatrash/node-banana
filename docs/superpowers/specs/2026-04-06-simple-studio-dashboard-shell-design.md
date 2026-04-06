# Simple Studio — Dashboard Shell Redesign

**Date:** 2026-04-06
**Status:** Design approved, pending implementation plan
**Scope:** Replace the bespoke `/studio/simple` shell with a sidebar+header dashboard shell that matches the pattern used by `/social/*`, and split the single-page simple studio into five dedicated routes (Images, Videos, Copy, Library, Prompt Library) under a new top-level `/simple-studio` path. Forms render inline as the main content on each creation route — no drawer pattern.

## Motivation

The current `/studio/simple` page uses a bespoke two-panel layout (a 380 px left `<aside>` containing the generation form and a right-side results gallery wrapped in a custom `<Header />`). It does not share the dashboard shell pattern used elsewhere in the app, does not integrate with `AppSwitcher` from a sidebar, and conflates three distinct generation modes (photo/video/copy) into one page via internal tabs. This makes navigation and discoverability worse than the equivalent `/social` pillar, which already uses `SidebarProvider` + `SidebarInset` + `SocialAppSidebar` + `SocialSiteHeader`.

This spec describes a full rebuild of the simple-studio shell, mirroring the social pattern, with the old route preserved in parallel during development and deleted in a second follow-up PR after verification.

## High-level architecture

- New top-level URL: `/simple-studio/*` (kebab-case, matching existing route conventions).
- `/studio` becomes strictly the advanced node editor. Simple-studio no longer lives under `/studio`.
- New shell mirrors `SocialLayout` + `SocialAppSidebar` + `SocialSiteHeader` (`SidebarProvider` + `SidebarInset`, same CSS vars for `--sidebar-width` and `--header-height`).
- Five child routes:
  - `/simple-studio/images` — image generation (form-first page).
  - `/simple-studio/videos` — video generation (form-first page).
  - `/simple-studio/copy` — text/copy generation (form-first page).
  - `/simple-studio/library` — gallery of all past generations across all modes, with mode filter.
  - `/simple-studio/prompt-library` — prompt templates + user-saved prompts.
- **Form-first inline layout.** Each `/images`, `/videos`, `/copy` page renders the generation form as its main content (not in a drawer). The form occupies a center column and a right-side info panel shows aspect ratio picker, estimated cost, output example, and tips — matching the pattern used by tools like revid.ai. There is no drawer anywhere in the design.
- **Library separation.** Past generations live on a dedicated `/simple-studio/library` route, not below or beside the form. This keeps the creation pages clean and single-purpose, and gives the library enough space to support mode filters and batch management.
- **Reuse existing backend.** The project already has a `saved_prompts` table in Drizzle (`src/lib/db/schema.ts:1151`), a full CRUD API under `/api/studio/prompts` (list, create, update, delete, plus a `/public` variant for templates), and store actions on `useSimpleStudioStore` (`saveCurrentPrompt`, `loadSavedPrompts`, `loadPublicPrompts`, `applyPrompt`). The redesign reuses all of this unchanged — no new tables, no new routes, no duplication. "Templates" are simply saved prompts with `isPublic: true`, served by the existing public endpoint.
- **URL-to-mode mapping.** The URL uses friendly English plurals — `/simple-studio/images`, `/videos`, `/copy` — while the internal mode enum stays `"photo" | "video" | "copy"` to match the existing store and DB enum. A small mapping in `SimpleStudioLayout` sets the correct mode on route change.
- `AppSwitcher` gains a dedicated "Simple Studio" pillar entry alongside a renamed "Advanced Workflow" entry (formerly "AI Studio").

## Routing

### New routes

```
src/app/simple-studio/
  layout.tsx                  server: auth gate + <SimpleStudioLayout> shell wrapper
  page.tsx                    redirect('/simple-studio/images')
  images/page.tsx
  videos/page.tsx
  copy/page.tsx
  library/page.tsx
  prompt-library/page.tsx
```

The `layout.tsx` server component:
- Calls `getServerAuthSession(await headers())` and redirects unauthenticated users to `/sign-in?next=%2Fsimple-studio%2Fimages` (same pattern as `src/app/social/layout.tsx`).
- Renders `<SimpleStudioLayout>{children}</SimpleStudioLayout>` on success.

No route groups are needed — because the new routes live at a different top-level path (`/simple-studio` not `/studio/simple`), they naturally do not interact with the old code.

### Old `/studio/simple` route lifecycle

1. **During development (PR 1):** `src/app/studio/simple/` is 100% untouched. `/studio/simple` continues to render the existing `SimpleStudioClient.tsx`. New routes at `/simple-studio/*` are built in parallel.
2. **Verification window:** Both UIs live in production simultaneously. Users can reach the old UI only by direct URL; nothing in the new shell links to it.
3. **Cleanup (PR 2, after verification):**
   - Delete `src/app/studio/simple/page.tsx`, `src/app/studio/simple/SimpleStudioClient.tsx`, and `src/app/studio/simple/__tests__/`.
   - Delete the entire `src/components/simple-studio/` directory (`Sidebar.tsx`, `ResultsGallery.tsx`, `GenerationCard.tsx`, `PromptLibrary.tsx`) — grep-check first for unexpected consumers.
   - Replace `src/app/studio/simple/page.tsx` with a minimal redirect stub:
     ```ts
     import { redirect } from 'next/navigation';
     export default function Page() { redirect('/simple-studio/images'); }
     ```
   - Keeps old bookmarks working.
   - Update any `docs/` or `README.md` references.

## Shell components

All new components live in `src/components/simple-studio-shell/`, named after their social counterparts for consistency:

```
src/components/simple-studio-shell/
  SimpleStudioLayout.tsx
  SimpleStudioAppSidebar.tsx
  SimpleStudioSiteHeader.tsx
  LibraryGallery.tsx
  PromptLibraryTabs.tsx        templates + saved tabs for /prompt-library page
  SavePromptDialog.tsx
  urlToMode.ts                 URL segment ↔ SimpleStudioMode mapping
  forms/
    FormPageLayout.tsx         shared 2-column shell (form body left, info panel right)
    FormInfoPanel.tsx          aspect ratio + cost estimate + output example + tips
    ImageForm.tsx
    VideoForm.tsx
    CopyForm.tsx
```

### `SimpleStudioLayout.tsx` (client)

Thin wrapper over `SidebarProvider` + `SidebarInset`. Mirrors `SocialLayout.tsx`:

```tsx
<SidebarProvider
  style={{
    "--sidebar-width": "calc(var(--spacing) * 64)",
    "--header-height": "calc(var(--spacing) * 12)",
  } as React.CSSProperties}
>
  <SimpleStudioAppSidebar variant="inset" />
  <SidebarInset>
    <SimpleStudioSiteHeader />
    <div className="flex flex-1 flex-col">{children}</div>
  </SidebarInset>
</SidebarProvider>
```

Also:
- Watches `usePathname()` and calls `useSimpleStudioStore.setMode(modeFromPathname(pathname))` whenever the active route changes, so the store's internal mode stays in sync with the URL.
- Triggers initial load of recent results via `useSimpleStudioStore.loadRecentResults()` on first mount (mirrors the `SocialLayout` `fetchAccounts` pattern using a `useRef` flag to avoid `useEffect`).
- No keyboard shortcut for opening a drawer — forms are always visible inline, so there is nothing to toggle.

### `SimpleStudioAppSidebar.tsx` (client)

Mirrors `SocialAppSidebar.tsx`:

- **Header:** `AppSwitcher` trigger showing a `PaletteIcon` + "Simple Studio".
- **Navigation group — Create (`SidebarGroupLabel="Create"`):**
  - Images → `/simple-studio/images` (`ImageIcon`)
  - Videos → `/simple-studio/videos` (`VideoIcon`)
  - Copy → `/simple-studio/copy` (`FileTextIcon`)
- **Separator**
- **Navigation group — Browse (`SidebarGroupLabel="Browse"`):**
  - Library → `/simple-studio/library` (`GalleryThumbnailsIcon` or `ImagesIcon`)
  - Prompt Library → `/simple-studio/prompt-library` (`BookmarkIcon`)
- **Footer:** `<NavUser user={...} />` with `authClient.useSession()`.
- `collapsible="offcanvas"`, `variant="inset"`, same active-state detection (`pathname === item.href || pathname?.startsWith(item.href + "/")`).
- No "Advanced Workflow" sidebar item — that link lives exclusively in the `AppSwitcher` dropdown.

Grouping Create/Browse visually separates "making new things" from "browsing what exists" and keeps related items clustered.

### `SimpleStudioSiteHeader.tsx` (client)

Mirrors `SocialSiteHeader.tsx`:

- `SidebarTrigger` on the left, vertical separator, page title.
- Title sourced from a `PAGE_TITLES` record mapped by pathname:
  ```ts
  const PAGE_TITLES: Record<string, string> = {
    "/simple-studio/images": "Images",
    "/simple-studio/videos": "Videos",
    "/simple-studio/copy": "Copy",
    "/simple-studio/library": "Library",
    "/simple-studio/prompt-library": "Prompt Library",
  };
  ```
- Right-aligned action area (varies by route):
  - `/simple-studio/images`, `/videos`, `/copy`: no primary action button. The Generate button lives inside the form itself, which is always visible on these pages. A secondary ghost "Save prompt" button may appear when the form has prompt text — it opens `SavePromptDialog` prefilled with the current form state.
  - `/simple-studio/library`: a `BatchFilter` pill group (All / Images / Videos / Copy).
  - `/simple-studio/prompt-library`: "New Saved Prompt" button that opens `SavePromptDialog` with empty fields.

### `SavePromptDialog.tsx` (client)

A small shadcn `Dialog` used in two places:

- Opened from the "Save prompt" ghost button on a form page — the user enters a name and clicks Save. The dialog reads the current form state straight from `useSimpleStudioStore` and calls `saveCurrentPrompt(name)`, which posts to `/api/studio/prompts` and prepends the new row to `savedPrompts`.
- Opened from the "New Saved Prompt" header button on `/simple-studio/prompt-library` — empty, user fills in name + prompt text. It sets the store's `prompt` and `mode` first, then calls `saveCurrentPrompt(name)` and refreshes the Saved tab.

The dialog's open state lives in `useSimpleStudioShellStore` (`savePromptDialogOpen`). All data operations go through the existing `useSimpleStudioStore` — this component does not talk to the API directly.

## Form components

Three fresh per-mode forms under `src/components/simple-studio-shell/forms/`, rendered inline as the main content of their respective route pages. The existing `src/components/simple-studio/Sidebar.tsx` (the old monolithic form) is NOT touched during PR 1 — it is deleted wholesale in PR 2 after the new forms are verified.

All three forms read/write the existing `useSimpleStudioStore` (not the new shell store). This keeps form state, generation state, and batch tracking exactly as they are today, which minimizes the risk surface.

### Shared layout: `FormPageLayout.tsx`

A reusable 2-column layout used by all three form pages:

```tsx
<FormPageLayout infoPanel={<FormInfoPanel ... />}>
  {/* form body */}
</FormPageLayout>
```

- **Left column (main):** `max-w-2xl` centered, contains the form body and the prominent Generate button.
- **Right column (`w-80` fixed):** `FormInfoPanel` with aspect ratio picker, batch count, estimated cost, output example, model-specific tips.
- On viewports below the `lg` breakpoint, the info panel stacks above the form body instead of sitting beside it.
- When generation is in flight, the info panel's "Output Example" area flips to an in-progress state showing per-item progress cards (replaces the old page's `MobileProgress` floating bar with something that always lives in the same spot).

### Per-form concerns

- **`ImageForm.tsx`** — prompt textarea, model picker (filtered to image-capable models), optional reference image upload. Sends aspect ratio and batch count from the info panel via the shared store.
- **`VideoForm.tsx`** — prompt textarea, model picker (video-capable), duration picker, optional reference image upload. Aspect ratio + batch count from info panel.
- **`CopyForm.tsx`** — prompt textarea, LLM model picker, tone, platform. Batch count from info panel (aspect ratio hidden — not meaningful for text).

`FormInfoPanel.tsx` accepts props for which controls to show (`{ aspectRatios, batchPresets, outputExample, tips }`) so the three forms can customize without duplicating the panel shell.

Some visual duplication between the three form bodies is acceptable beyond `FormPageLayout` and `FormInfoPanel`; further extraction of shared primitives is explicitly deferred to a follow-up PR after PR 2's cleanup.

Each form's submit handler calls the existing `useSimpleStudioStore.generate()` action. After successful submit, the form does NOT navigate — the info panel flips to a progress view and, when complete, shows the latest results inline with a "View all in Library" link to `/simple-studio/library`.

## Page content

### `/simple-studio/images`, `/videos`, `/copy`

Each route's `page.tsx` is a thin client component that renders the corresponding form inside the shared layout:

```tsx
// /simple-studio/images/page.tsx
export default function ImagesPage() {
  return <ImageForm />;
}
```

`ImageForm` internally wraps its body in `FormPageLayout` and passes the appropriate `FormInfoPanel` config. The form is the entire page content below the `SimpleStudioSiteHeader` — there is no separate gallery section on these pages.

### `/simple-studio/library`

New dedicated gallery route. Renders `LibraryGallery` as the main content:

- Filter pills: All / Images / Videos / Copy (syncs with the `BatchFilter` in the site header for this route).
- Grid of past generations from `useSimpleStudioStore.generations`, sorted newest-first, grouped visually by batch.
- Click a card to open a preview modal with full resolution, prompt text, regenerate button, and delete button.
- Empty state: "No generations yet" with buttons linking to `/simple-studio/images`, `/videos`, `/copy`.
- Image and video results render as media thumbnails; copy results render as text cards with truncated content.

`LibraryGallery.tsx` reads from `useSimpleStudioStore.generations` and applies `useSimpleStudioShellStore.libraryModeFilter`. The old `src/components/simple-studio/ResultsGallery.tsx` is not reused — it stays untouched for PR 1 and is deleted in PR 2.

### `/simple-studio/prompt-library`

Renders a shadcn `Tabs` component with two tabs:

- **Templates** (default) — grid of `SavedPrompt` cards where `isPublic === true`, loaded via `useSimpleStudioStore.loadPublicPrompts()`. Each card shows name, prompt text preview (first ~120 chars), mode badge, and a "Use" button. A mode filter (`All` / `Photo` / `Video` / `Copy`) filters the grid client-side. Empty state: "No templates yet" explaining that templates are coming soon (or seeded separately).
- **Saved** — grid of the workspace's private saved prompts (`isPublic === false`), loaded via `useSimpleStudioStore.loadSavedPrompts()`. Each card has edit and delete actions. Empty state: "No saved prompts yet" with a CTA to go to a form page and save one.

Clicking "Use" on any prompt (template or saved) calls:
1. `useSimpleStudioStore.applyPrompt(prompt)` — writes the prompt's `mode`, `promptText`, and `formConfig` into the store.
2. `router.push('/simple-studio/' + MODE_TO_URL_SEGMENT[prompt.mode])` — navigates to the corresponding form page.

The target form page already renders inline, so the prefilled fields are visible immediately on landing — no drawer to open, no extra click.

Loading strategy: the prompt-library page calls `loadPublicPrompts()` and `loadSavedPrompts()` on mount. These are already throttled by the existing store (they don't refetch on every mount cycle in practice; plans can add a simple guard if needed).

## Data model & API — REUSE EXISTING

This redesign does NOT introduce any new database tables, API routes, or repository functions. Everything needed already exists and is reused unchanged.

### Existing table: `saved_prompts` (`src/lib/db/schema.ts:1151`)

```ts
export const savedPrompts = pgTable("saved_prompts", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  mode: savedPromptModeEnum("mode").notNull(), // "photo" | "video" | "copy"
  name: text("name").notNull(),
  promptText: text("prompt_text").notNull(),
  formConfig: jsonb("form_config").$type<Record<string, unknown>>().default({}).notNull(),
  isPublic: boolean("is_public").default(false).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
}, (table) => ({ /* indexes */ }));
```

Key characteristics:
- **Workspace-scoped, not user-scoped.** Matches the project's authz model — all prompts belong to a workspace, and access is gated by workspace membership via `authorizeStudioRequest`.
- **Mode enum is `"photo" | "video" | "copy"`.** The spec's URL scheme uses `/images` for friendly English plural, but the internal mode is `"photo"`. A single constant in `SimpleStudioLayout` maps between the two.
- **`isPublic` flag is the template mechanism.** A prompt with `isPublic: true` shows up in the Templates tab (via the public endpoint). A prompt with `isPublic: false` is private to the workspace and shows up in the Saved tab.
- **Soft delete via `deletedAt`.** Existing routes and repository already handle this.

### Existing API routes

All already implemented, tested, and wired into the old store. No changes needed:

```
GET    /api/studio/prompts?mode=<photo|video|copy>   → workspace's saved prompts (src/app/api/studio/prompts/route.ts)
POST   /api/studio/prompts                           → create (accepts isPublic)
GET    /api/studio/prompts/public?mode=<mode>        → public prompts (templates) for Templates tab
PATCH  /api/studio/prompts/[promptId]                → update
DELETE /api/studio/prompts/[promptId]                → soft-delete
```

Authz lives in `src/lib/studio/authz.ts` (`authorizeStudioRequest`). Repository layer is `src/lib/studio/repository.ts` (`createPrompt`, `listPrompts`, etc.). Existing tests in `src/app/api/studio/prompts/__tests__/` and `src/app/api/studio/prompts/public/__tests__/` cover the routes.

### Existing store actions (in `useSimpleStudioStore`)

Also already wired — the new shell components call these directly:

- `saveCurrentPrompt(name)` — POSTs `/api/studio/prompts` with the current form state as `formConfig`, prepends the result to `savedPrompts`.
- `loadSavedPrompts()` — GETs `/api/studio/prompts?mode=<current mode>`.
- `loadPublicPrompts()` — GETs `/api/studio/prompts/public?mode=<current mode>`.
- `applyPrompt(prompt)` — writes `mode`, `prompt`, and all form fields from the given `SavedPrompt` into the store (used by the "Use" button on both tabs).

### Templates seed content — out of scope

The Templates tab will be empty on first load until public prompts exist in the database. Seeding the curated starter set of public prompts is explicitly out of scope for PR 1 and is tracked as a follow-up — either a SQL seed script, a one-off admin POST with `isPublic: true`, or a dedicated seed route. The Templates tab shows a clear empty state ("No templates yet") when there are none.

## State management

### New `useSimpleStudioShellStore` — UI state only

Because all data operations (templates, saved prompts, generations) already live in `useSimpleStudioStore`, the new shell store is drastically thinner than earlier spec drafts. It owns only UI state that the existing store does not need to know about:

```ts
interface SimpleStudioShellState {
  // SavePromptDialog open state (shared between form pages and prompt-library page)
  savePromptDialogOpen: boolean;
  openSavePromptDialog: () => void;
  closeSavePromptDialog: () => void;

  // Library mode filter (syncs with URL ?mode=... on /simple-studio/library)
  libraryModeFilter: 'all' | 'photo' | 'video' | 'copy';
  setLibraryModeFilter: (mode: 'all' | 'photo' | 'video' | 'copy') => void;

  // Prompt Library active tab
  promptLibraryTab: 'templates' | 'saved';
  setPromptLibraryTab: (tab: 'templates' | 'saved') => void;
}
```

That's the entire store. No API calls, no templates, no saved-prompts array, no optimistic update logic. All of that already exists in `useSimpleStudioStore`.

### `useSimpleStudioStore` — reused directly, NOT touched

The existing store continues to power both the old `/studio/simple` page AND the new shell's forms, galleries, and prompt library. The new shell components call its existing actions (`generate`, `saveCurrentPrompt`, `loadSavedPrompts`, `loadPublicPrompts`, `applyPrompt`, etc.) directly — no wrapper, no proxy, no parallel state.

The store's `mode` field is still authoritative. On route change within the simple studio shell, `SimpleStudioLayout` calls `setMode()` with the mapped mode (see URL-to-mode mapping below).

### URL-to-mode mapping

```ts
// src/components/simple-studio-shell/urlToMode.ts
import type { SimpleStudioMode } from '@/store/simpleStudioStore';

export const URL_SEGMENT_TO_MODE: Record<string, SimpleStudioMode> = {
  images: 'photo',
  videos: 'video',
  copy: 'copy',
};

export const MODE_TO_URL_SEGMENT: Record<SimpleStudioMode, string> = {
  photo: 'images',
  video: 'videos',
  copy: 'copy',
};

export function modeFromPathname(pathname: string): SimpleStudioMode | null {
  const match = pathname.match(/^\/simple-studio\/(images|videos|copy)(\/|$)/);
  return match ? URL_SEGMENT_TO_MODE[match[1]] ?? null : null;
}
```

`SimpleStudioLayout` watches the pathname and calls `useSimpleStudioStore.setMode(...)` whenever the route mode changes. `applyPrompt` continues to set the mode internally when a template is applied, so navigation after apply uses `MODE_TO_URL_SEGMENT[prompt.mode]`.

## AppSwitcher updates

Current `src/components/AppSwitcher.tsx` pillar list:

```tsx
const PILLAR_ITEMS = [
  { href: "/studio",          label: "AI Studio",    icon: PaletteIcon },
  { href: "/editor/projects", label: "Video Editor", icon: VideoIcon },
  { href: "/social",          label: "Social Hub",   icon: ActivityIcon },
  { href: "/analytics",       label: "Analytics",    icon: BarChart3Icon },
]
```

New pillar list:

```tsx
const PILLAR_ITEMS = [
  { href: "/simple-studio/images", label: "Simple Studio",     icon: PaletteIcon },
  { href: "/studio",               label: "Advanced Workflow", icon: WorkflowIcon },
  { href: "/editor/projects",      label: "Video Editor",      icon: VideoIcon },
  { href: "/social",               label: "Social Hub",        icon: ActivityIcon },
  { href: "/analytics",            label: "Analytics",         icon: BarChart3Icon },
]
```

The existing `pathname?.startsWith(item.href + "/")` active-state logic already handles `/simple-studio/*` sub-routes. No other logic changes.

## Mobile behavior

- Nav sidebar uses `collapsible="offcanvas"` (same as social) — collapses to a hamburger on mobile via `SidebarTrigger`.
- `FormPageLayout` stacks its two columns vertically below the `lg` breakpoint: info panel first (aspect ratio, cost estimate, output example), form body below. This keeps the most-scanned content at the top of the viewport where users look first, and lets the prompt textarea sit just above the keyboard when focused.
- `LibraryGallery` uses a responsive grid (2 columns on mobile, 3-4 on desktop).
- `BatchFilter` in the site header collapses to a single dropdown on mobile to save horizontal space.
- The old page's bespoke `MobileProgress` floating bar is NOT ported — progress feedback lives inside `FormInfoPanel`'s "Output Example" area, which is always visible on mobile (since it stacks above the form body) and naturally replaces itself with live generation progress while the user waits.

## Testing strategy

### Unit / component tests

- `src/components/simple-studio-shell/__tests__/SimpleStudioAppSidebar.test.tsx` — renders 5 nav items grouped as Create / Browse, active state matches mocked `usePathname`, AppSwitcher trigger present.
- `src/components/simple-studio-shell/__tests__/SimpleStudioSiteHeader.test.tsx` — title derives from pathname, library route shows `BatchFilter`, prompt-library route shows "New Saved Prompt" button, form routes show no primary action button.
- `src/components/simple-studio-shell/forms/__tests__/ImageForm.test.tsx`, `VideoForm.test.tsx`, `CopyForm.test.tsx` — one happy-path test each: required fields render inline, Generate button triggers the store action with expected payload.
- `src/components/simple-studio-shell/forms/__tests__/FormPageLayout.test.tsx` — renders form body + info panel side-by-side above the `lg` breakpoint, stacks vertically below.
- `src/components/simple-studio-shell/__tests__/LibraryGallery.test.tsx` — renders all generations when filter is `all`, filters correctly when set to `image`/`video`/`copy`, empty state when no generations.

### Store tests

- `src/store/__tests__/simpleStudioShellStore.test.ts`:
  - `openSavePromptDialog` / `closeSavePromptDialog` toggle `savePromptDialogOpen`.
  - `setLibraryModeFilter` updates state correctly for all four values.
  - `setPromptLibraryTab` updates state between `templates` and `saved`.

- `src/components/simple-studio-shell/__tests__/urlToMode.test.ts`:
  - `modeFromPathname` returns the correct mode for each route.
  - `modeFromPathname` returns `null` for non-form routes (library, prompt-library, root).
  - `URL_SEGMENT_TO_MODE` and `MODE_TO_URL_SEGMENT` are inverses of each other for all three modes.

### API route tests

No new API route tests. The existing tests under `src/app/api/studio/prompts/__tests__/` and `src/app/api/studio/prompts/public/__tests__/` already cover the routes this redesign uses, and those routes are not being modified.

### Explicitly untested

- Hardcoded template content.
- Visual snapshots (not used elsewhere in the repo).
- Drag-and-drop reference image upload inside the forms (matches the coverage level of the old `Sidebar.tsx`).
- The responsive breakpoint crossover in `FormPageLayout` (CSS-only, tested manually in browser dev tools).

### Existing tests

All tests under `src/app/studio/simple/__tests__/` stay untouched for PR 1 and are deleted in PR 2 alongside the old code.

## Verification checklist (manual QA before merging PR 1)

1. `/simple-studio` redirects to `/simple-studio/images`.
2. All 5 sidebar nav items (Images, Videos, Copy, Library, Prompt Library) load and highlight correctly, grouped as Create / Browse.
3. AppSwitcher dropdown shows "Simple Studio" and "Advanced Workflow" as separate entries; current route lights up for any `/simple-studio/*` sub-route.
4. Navigating between `/images`, `/videos`, `/copy` sets the correct internal mode in `useSimpleStudioStore` (verifiable via React DevTools or by observing model picker contents change).
5. Each form route renders the form inline with the info panel on the right (desktop) or stacked (mobile).
6. Generate an image / video / copy from each respective form — progress appears in the info panel's "Output Example" area, and the result appears inline once complete. Confirm the same generation appears in `/simple-studio/library`.
7. Library page shows all past generations with the correct mode filter; filter pills in the site header match and URL query param updates.
8. Prompt Library Templates tab: if the `saved_prompts` table contains rows with `isPublic: true` for the current mode, they appear. If not, the empty state is visible. Clicking "Use" on a template navigates to the correct form route (via `MODE_TO_URL_SEGMENT[prompt.mode]`) and prefills the form.
9. "Save prompt" button on a form page opens `SavePromptDialog`. Entering a name and clicking Save calls `saveCurrentPrompt`, which POSTs to `/api/studio/prompts`, and the new prompt appears in the Saved tab immediately.
10. "New Saved Prompt" button on `/simple-studio/prompt-library` opens `SavePromptDialog` with empty fields. Filling in name + prompt + mode and saving calls `saveCurrentPrompt` after seeding the store, and the prompt appears in the Saved tab.
11. Delete a saved prompt → removed from list and persists on reload (the existing DELETE endpoint handles this).
12. Switching workspaces (if applicable) shows that workspace's saved prompts only (existing workspace scoping verified to still work through the new UI).
13. Old `/studio/simple` route still loads, renders the legacy UI, and is functionally untouched — the existing integration tests in `src/app/studio/simple/__tests__/` still pass.
14. `pnpm test:run` passes, `pnpm lint` passes, `pnpm build` succeeds.

## Delivery plan

Two PRs against `develop`:

**PR 1 — Build new shell in parallel.**
- All new files (shell components, forms, pages, shell store, URL-to-mode mapping).
- `AppSwitcher` update.
- NO new DB schema, NO new API routes, NO new migrations — existing `/api/studio/prompts` infrastructure is reused unchanged.
- `useSimpleStudioStore` is NOT modified.
- All tests listed in the Testing strategy section.
- Old `/studio/simple` tree is NOT touched.
- Merged after the full verification checklist passes.

**PR 2 — Delete old simple studio.**
- Delete `src/app/studio/simple/page.tsx`, `SimpleStudioClient.tsx`, `__tests__/`.
- Delete entire `src/components/simple-studio/` directory after a grep confirms no external consumers.
- Add redirect stub at `src/app/studio/simple/page.tsx` pointing to `/simple-studio/images` for bookmark compatibility.
- Update any `docs/` or `README.md` references to the old path.
- Re-run the verification checklist (excluding item 11).

Two PRs keep rollback cheap: if PR 1 is in production and a regression surfaces, PR 2 has not yet removed the fallback UI, so reverting PR 1 restores the prior behavior without resurrecting deleted files.

## Out of scope

- Refactoring the old `Sidebar.tsx` to extract shared primitives before deletion.
- Admin UI for managing prompt templates.
- Seeding public prompt templates into the database (tracked as follow-up — templates tab shows empty state until seeded).
- Any modification to the `saved_prompts` schema, existing API routes, or `useSimpleStudioStore`.
- New DB tables or migrations of any kind.
- Tags, folders, or categories on saved prompts.
- Sharing saved prompts across workspaces.
- Import / export of prompt libraries.
- Pagination on saved prompts endpoint (the existing endpoint does not paginate; v1 inherits this limitation).
- A `/simple-studio` landing page beyond the redirect.
- Touching the advanced workflow editor at `/studio/[[...projectId]]`.
- Porting the mobile `MobileProgress` floating bar (replaced by inline info-panel progress).
- Extracting shared form primitives beyond `FormPageLayout` + `FormInfoPanel` (deferred until after PR 2).
- Multi-step wizard-style forms — the design uses single-page inline forms, not a numbered stepper.
- Batch management actions inside Library (bulk delete, bulk download) — v1 supports per-card actions only.
