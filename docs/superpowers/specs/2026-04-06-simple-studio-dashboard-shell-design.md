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
  SavePromptDialog.tsx
  forms/
    FormPageLayout.tsx         shared 2-column shell (form body left, info panel right)
    ImageForm.tsx
    VideoForm.tsx
    CopyForm.tsx
    FormInfoPanel.tsx          aspect ratio + cost estimate + output example + tips
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
- Hydrates prompt templates + saved prompts via `useSimpleStudioShellStore` on first mount (mirrors the `SocialLayout` `fetchAccounts` pattern using a `useRef` flag to avoid `useEffect`).
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

- Opened from the "Save prompt" ghost button on a form page — prefilled with the current form's prompt text and defaults. User confirms title and clicks Save. On success, dialog closes and a toast confirms.
- Opened from the "New Saved Prompt" header button on `/simple-studio/prompt-library` — empty, user fills in title + prompt + kind. On success, dialog closes and the Saved tab refreshes (optimistically).

Calls `useSimpleStudioShellStore.saveSavedPrompt(input)`.

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

- **Templates** (default) — grid of `PromptTemplate` cards. Each card shows title, description, prompt preview (first ~120 chars), kind badge, optional thumbnail, and a "Use" button. A kind filter (`All` / `Images` / `Videos` / `Copy`) filters the grid.
- **Saved** — grid of the current user's saved prompts with edit and delete actions. Empty state: "No saved prompts yet" with a CTA to go generate and save one.

Clicking "Use" on a template or saved prompt calls `useSimpleStudioShellStore.applyTemplate(template)`, which:
1. Writes the template's `prompt` and `defaults` into `useSimpleStudioStore` (matching the `kind`).
2. Calls `router.push('/simple-studio/images' | '/videos' | '/copy')` based on `kind`.

The target page already renders the form inline, so the prefilled fields are visible immediately on landing — no drawer to open, no extra click.

## Data model & API

### Prompt templates (hardcoded, DB-shaped)

```ts
// src/lib/simple-studio/prompt-templates.ts
export type PromptTemplateKind = 'image' | 'video' | 'copy';

export interface PromptTemplate {
  id: string;
  kind: PromptTemplateKind;
  title: string;
  description: string;
  prompt: string;
  thumbnailUrl?: string;
  defaults?: {
    model?: string;
    aspectRatio?: string;
    tone?: string;
    platform?: string;
  };
  tags?: string[];
}

export const PROMPT_TEMPLATES: PromptTemplate[] = [ /* ~15 curated entries */ ];
```

Served via `GET /api/simple-studio/templates`, which returns the in-memory array. Putting this behind an API boundary means migrating to a DB-backed store later only changes `route.ts`, not client code.

Starter content: roughly 5 image templates, 5 video templates, 5 copy templates. Exact content TBD by whoever writes them; selection does not affect the architecture.

### Saved prompts (Postgres via Drizzle)

New table added to `src/lib/db/schema.ts`, referencing the existing Better Auth `user` table (exported as `user`, singular — not `users`):

```ts
export const simpleStudioSavedPrompts = pgTable('simple_studio_saved_prompts', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  kind: text('kind', { enum: ['image', 'video', 'copy'] }).notNull(),
  title: text('title').notNull(),
  prompt: text('prompt').notNull(),
  defaults: jsonb('defaults').$type<PromptTemplate['defaults']>(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (t) => ({
  userIdIdx: index('simple_studio_saved_prompts_user_id_idx').on(t.userId),
}));
```

Migration generated via Drizzle's standard `drizzle-kit generate` flow and committed to the project's Drizzle migrations directory. Cascade-on-user-delete because saved prompts are personal data that should follow the user.

Explicitly excluded from v1:
- `tags` column.
- `referenceImageUrl` column (reference image capture on save).
- Sharing, folders, or categories.
- Pagination.

### API routes

```
GET    /api/simple-studio/templates                 → PromptTemplate[]
GET    /api/simple-studio/saved-prompts             → SavedPrompt[]
POST   /api/simple-studio/saved-prompts             → SavedPrompt
PATCH  /api/simple-studio/saved-prompts/[id]        → SavedPrompt
DELETE /api/simple-studio/saved-prompts/[id]        → { ok: true }
```

All routes:
- Use `getServerAuthSession` for auth. Return `401` with `{ error: 'Unauthorized' }` if no session.
- On `PATCH` / `DELETE`, the `WHERE` clause includes `AND userId = :session.user.id`. If zero rows are affected, return `404` — do not leak existence of other users' rows.
- Validate request bodies with Zod schemas (project already uses Zod in other routes; confirm and match style during planning).
- `POST` body: `{ kind, title, prompt, defaults? }`. `PATCH` body: any subset of `{ title, prompt, defaults }` — `kind` is immutable.

## State management

### New `useSimpleStudioShellStore`

Separate from the existing `useSimpleStudioStore` because the shell's concerns (templates, saved prompts, save-dialog state, use-template navigation) are independent of the form/generation state:

```ts
interface SimpleStudioShellState {
  // Save prompt dialog
  savePromptDialogOpen: boolean;
  savePromptDialogSeed: Partial<SavedPromptInput> | null;
  openSavePromptDialog: (seed?: Partial<SavedPromptInput>) => void;
  closeSavePromptDialog: () => void;

  // Library filter (syncs with URL ?mode=...)
  libraryModeFilter: 'all' | 'image' | 'video' | 'copy';
  setLibraryModeFilter: (mode: 'all' | 'image' | 'video' | 'copy') => void;

  // Templates
  templates: PromptTemplate[];
  templatesLoaded: boolean;
  hydrateTemplates: () => Promise<void>;

  // Saved prompts
  savedPrompts: SavedPrompt[];
  savedPromptsLoaded: boolean;
  hydrateSavedPrompts: () => Promise<void>;
  saveSavedPrompt: (input: SavedPromptInput) => Promise<void>;   // optimistic
  updateSavedPrompt: (id: string, patch: Partial<SavedPromptInput>) => Promise<void>;
  deleteSavedPrompt: (id: string) => Promise<void>;              // optimistic

  // Apply-template flow
  applyTemplate: (template: PromptTemplate | SavedPrompt) => void; // writes to simpleStudioStore + router.push
}
```

Optimistic updates on `saveSavedPrompt` and `deleteSavedPrompt`: apply the change locally immediately, call the API, rollback on failure with a toast.

Note: no `createDrawerOpen` state — the design has no drawer. The `savePromptDialog*` state is the only UI-overlay state in this store.

### `useSimpleStudioStore` — untouched for PR 1

No changes. The old store continues to power both the old `/studio/simple` page AND the new per-mode forms. This is intentional: keeping the generation state machine exactly as-is minimizes regression risk.

Under the new shell, the old store's `mode` field becomes vestigial (the route implies the mode). It stays in the store for PR 1 so the old page keeps working and can be removed or repurposed in PR 2 or a later follow-up.

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
  - `openSavePromptDialog` / `closeSavePromptDialog` toggle state and seed data.
  - `setLibraryModeFilter` updates state.
  - `hydrateTemplates` populates from a mocked `fetch`.
  - `saveSavedPrompt` applies optimistically and rolls back on API failure.
  - `applyTemplate` writes to `simpleStudioStore` and navigates via mocked `router.push`.

### API route tests

- `src/app/api/simple-studio/templates/__tests__/route.test.ts` — returns array shape and length > 0.
- `src/app/api/simple-studio/saved-prompts/__tests__/route.test.ts`:
  - `401` without session on every verb.
  - `POST` creates a row with `userId` from the session.
  - `GET` returns only the session user's rows.
  - `PATCH` and `DELETE` enforce ownership (`user A` gets `404` when targeting `user B`'s row).
  - `POST` with invalid body returns `400`.

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
3. AppSwitcher dropdown shows "Simple Studio" and "Advanced Workflow" as separate entries; current route lights up.
4. Each of `/images`, `/videos`, `/copy` renders the form inline with the info panel on the right (desktop) or stacked (mobile).
5. Generate an image / video / copy from each respective form — progress appears in the info panel's "Output Example" area, and the result appears inline once complete.
6. Clicking "View all in Library" from an inline result navigates to `/simple-studio/library` with the correct mode filter active.
7. Library page shows all past generations with the correct filter; filter pills in the site header match.
8. Prompt Library Templates tab: click a template → navigates to the correct form route (images/videos/copy), form fields are prefilled on arrival, no extra click required.
9. "Save prompt" button on a form page opens `SavePromptDialog` prefilled with the current prompt text; saving adds it to the Saved tab.
10. "New Saved Prompt" button on `/simple-studio/prompt-library` opens `SavePromptDialog` with empty fields; saving adds it to the Saved tab.
11. Delete a saved prompt → removed from list (optimistic) and persists on reload.
12. Sign out, sign in as a different user → previous user's saved prompts are not visible (ownership enforced).
13. Old `/studio/simple` route still loads, renders the legacy UI, and is functionally untouched.
14. `pnpm test:run` passes, `pnpm lint` passes, `pnpm build` succeeds.

## Delivery plan

Two PRs against `develop`:

**PR 1 — Build new shell in parallel.**
- All new files and the `AppSwitcher` update.
- Drizzle schema + generated migration for `simple_studio_saved_prompts`.
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
- Tags, folders, or categories on saved prompts.
- Reference image capture in saved prompts.
- Sharing saved prompts between users or organizations.
- Import / export of prompt libraries.
- Pagination of saved prompts endpoint.
- A `/simple-studio` landing page beyond the redirect.
- Touching the advanced workflow editor at `/studio/[[...projectId]]`.
- Porting the mobile `MobileProgress` floating bar (replaced by inline info-panel progress).
- Extracting shared form primitives beyond `FormPageLayout` + `FormInfoPanel` (deferred until after PR 2).
- Multi-step wizard-style forms — the design uses single-page inline forms, not a numbered stepper.
- Batch management actions inside Library (bulk delete, bulk download) — v1 supports per-card actions only.
