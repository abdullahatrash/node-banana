# Simple Studio Mode — Design Spec

> Date: 2026-04-01
> Status: Approved design, pending implementation plan
> Goal: Add a form-based "Simple" generation mode alongside the existing workflow editor

## Summary

Add a second studio experience at `/studio/simple` — a form-based generation interface where users fill in structured inputs and generate batches of AI photos, videos, or copy. It reuses the same backend endpoints (`/api/generate`, `/api/llm`, `/api/models`) and asset pipeline (R2 presign → upload → finalize) as the existing workflow editor, but with an independent UI and state.

The target audience is Middle East SMBs. Primary languages are Arabic and English. RTL is handled via shadcn's built-in RTL support and the existing `LanguageSwitcher`.

## Route Structure

| Route | Purpose |
|-------|---------|
| `/studio/simple` | Simple mode — form-based generation (new) |
| `/studio/[[...projectId]]` | Workflow mode — node editor (existing, unchanged) |

Both routes share `studio/layout.tsx` for auth guard.

Simple mode has no project context, no `workflowId`, no dependency on `workflowStore`.

## Navigation

The `Header` component gets a mode switcher pill near the logo:

```
[ Simple | Workflow ]
```

- Active mode is visually highlighted
- Clicking the other mode navigates via `router.push`
- In Simple mode, the Header is simplified: mode switcher + user menu + language switcher (no save/load/project name)
- In Workflow mode, Header stays exactly as-is with the switcher added

## Layout

Two-panel split:

- **Left sidebar** (~380px, collapsible on mobile): mode selector tabs at top, morphing form fields per mode, Generate button pinned at bottom
- **Right panel** (fluid): results gallery grid with progressive loading

Layout uses shadcn components with built-in RTL support. Sidebar is on `inline-start` side.

## Modes

Three MVP modes, selectable via tabs at the top of the sidebar:

### AI Photo (Photo / صورة)

| Field | Type | Details |
|-------|------|---------|
| Prompt | textarea | Main generation prompt |
| LLM Rewrite | toggle | When on, prompt is polished via `/api/llm` before generation |
| Reference Images | file uploader | 0-3 optional reference images |
| Model | select | From `/api/models` filtered to image capabilities |
| Aspect Ratio | pill selector | 1:1, 16:9, 9:16, 4:5 |
| Batch Count | number selector | 1-20 |

### AI Video (Video / فيديو)

| Field | Type | Details |
|-------|------|---------|
| Prompt | textarea | Main generation prompt |
| LLM Rewrite | toggle | Optional prompt polishing |
| Source Image | file uploader | Optional, for image-to-video |
| Model | select | From `/api/models` filtered to video capabilities |
| Duration | select | Model-dependent options |
| Resolution/Aspect Ratio | pill selector | Model-dependent options |
| Batch Count | number selector | 1-8 |

### AI Copy (Copy / نص)

| Field | Type | Details |
|-------|------|---------|
| Prompt | textarea | Content brief / description |
| Tone | select | Professional, Casual, Creative, Persuasive |
| Platform | select | Instagram, X, LinkedIn, General |
| Output Language | pill selector | Arabic, English, Both |
| Output Count | number selector | 1-20 |

## Generation Flow

1. User fills form, sets batch count (e.g., 12), hits **Generate**
2. If LLM rewrite is toggled on → single call to `/api/llm` to polish the prompt. User can preview the rewritten prompt before proceeding.
3. `simpleStudioStore.generate()` creates N generation entries with status `pending`
4. Sends requests in chunks of 3-4 concurrent calls to `/api/generate` (or `/api/llm` for copy mode)
5. Each completed result updates the gallery card from loading spinner → result
6. Each success is auto-persisted to R2 via existing presign → PUT → finalize flow
7. Failed items show error state with per-item retry button
8. Cancel button aborts all in-flight requests via AbortController

Same prompt is sent for all items in the batch — the API's inherent randomness produces variations.

## Results Gallery

- Responsive grid: 4 cols desktop, 3 cols tablet, 2 cols mobile
- Each card: thumbnail with loading spinner while generating, download button on hover, expand/preview on click
- Video results: play button overlay
- Copy results: text displayed in a card format
- Results grouped by generation run (divider with timestamp + prompt snippet)
- Gallery loads from `/api/studio/assets` filtered by `metadata.source = "simple"`, grouped by `metadata.batchId`
- Navigating away and returning reloads recent results from the assets API — no ephemeral state

## Asset Persistence

Every successful generation is auto-saved as a studio asset using the existing R2 pipeline:

1. `POST /api/studio/assets/presign` with `expectedSizeBytes`
2. `PUT` binary to presigned URL
3. `PATCH /api/studio/assets/[assetId]` to finalize as `ready`

Asset metadata includes:

```json
{
  "source": "simple",
  "mode": "photo",
  "prompt": "original prompt text",
  "batchId": "uuid — groups results from one generate action"
}
```

User can delete individual results (soft-delete via existing asset API).

## Prompt System

### Public Prompt Library

- Curated seed prompts organized by mode and category (product, fashion, food, real estate, social media, etc.)
- Stored as static data in `src/lib/simple-studio/promptTemplates.ts` (same pattern as workflow templates)
- Browsable via a "Templates" tab/section above the results gallery
- Clicking a template pre-fills all form fields (prompt + model + aspect ratio + other settings)
- User-submitted public prompts (via "Share to Library" action) deferred to post-MVP — MVP is curated seeds only

### Private Saved Prompts

- Workspace-scoped, stored in DB
- User can "Save Prompt" from the form → names it → appears in "My Prompts" section
- User can "Load Prompt" → pre-fills entire form including all settings
- Filterable by mode

## Data Model

### New DB table: `saved_prompts`

```sql
CREATE TABLE saved_prompts (
  id            TEXT PRIMARY KEY,
  workspace_id  TEXT NOT NULL REFERENCES workspaces(id),
  mode          TEXT NOT NULL,           -- 'photo' | 'video' | 'copy'
  name          TEXT NOT NULL,
  prompt_text   TEXT NOT NULL,
  form_config   JSONB NOT NULL DEFAULT '{}',  -- stores all mode-specific fields: modelId, aspectRatio, tone, platform, outputLanguage, videoDuration, etc.
  is_public     BOOLEAN NOT NULL DEFAULT false,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at    TIMESTAMPTZ
);
```

Indexes: `(workspace_id, deleted_at)`, `(is_public, mode, deleted_at)`.

### New API: `/api/studio/prompts`

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| GET | `/api/studio/prompts` | workspace read | List user's private prompts (`?mode=photo`) |
| GET | `/api/studio/prompts/public` | authenticated | List public prompt library |
| POST | `/api/studio/prompts` | workspace write | Save a new prompt |
| PATCH | `/api/studio/prompts/[promptId]` | workspace write | Update prompt |
| DELETE | `/api/studio/prompts/[promptId]` | workspace write | Soft-delete |

Follows the same auth + workspace scoping pattern as `/api/studio/projects` and `/api/studio/assets`.

## State Management

New Zustand store: `src/store/simpleStudioStore.ts` (~200-300 lines)

Separate from `workflowStore`. No dependency on nodes, edges, React Flow, or execution pipeline.

```typescript
interface SimpleStudioState {
  // Mode
  mode: 'photo' | 'video' | 'copy';
  setMode: (mode: SimpleStudioState['mode']) => void;

  // Form state (per-mode fields merged into one flat object)
  prompt: string;
  rewriteEnabled: boolean;
  rewrittenPrompt: string | null;
  selectedModelId: string | null;
  aspectRatio: string;
  batchCount: number;
  referenceImages: string[];
  sourceImage: string | null;
  videoDuration: number;
  tone: string;
  platform: string;
  outputLanguage: 'ar' | 'en' | 'both';

  // Generation
  isGenerating: boolean;
  isRewriting: boolean;
  currentBatchId: string | null;
  generations: Generation[];
  generate: () => Promise<void>;
  cancelGeneration: () => void;
  rewritePrompt: () => Promise<void>;

  // Gallery
  loadRecentResults: () => Promise<void>;

  // Prompts
  savedPrompts: SavedPrompt[];
  publicPrompts: SavedPrompt[];
  saveCurrentPrompt: (name: string) => Promise<void>;
  loadSavedPrompts: () => Promise<void>;
  loadPublicPrompts: () => Promise<void>;
  applyPrompt: (prompt: SavedPrompt) => void;
}

interface Generation {
  id: string;
  batchId: string;
  status: 'pending' | 'generating' | 'complete' | 'failed';
  result: string | null;
  assetId: string | null;
  error: string | null;
  mode: 'photo' | 'video' | 'copy';
}

interface SavedPrompt {
  id: string;
  mode: 'photo' | 'video' | 'copy';
  name: string;
  promptText: string;
  formConfig: Record<string, unknown>;
  isPublic: boolean;
}
```

### Key `generate()` behavior

1. If `rewriteEnabled` and no `rewrittenPrompt` → call `/api/llm` first
2. Create `batchCount` Generation entries with status `pending`
3. Process in chunks of 3-4 concurrent `fetch('/api/generate', ...)` calls
4. On each success → update generation entry, persist to R2 via presign flow
5. On cancel → abort in-flight requests via AbortController

## Backend Reuse (Zero Changes)

| Existing endpoint / system | Used by Simple mode for |
|----------------------------|------------------------|
| `/api/generate` | Image + video generation |
| `/api/llm` | Prompt rewrite + copy mode |
| `/api/models` + `/api/models/[modelId]` | Model listing + parameter schemas |
| `/api/studio/assets/presign` → PUT → finalize | Persisting results to R2 |
| `/api/studio/assets` | Listing/deleting results |
| `studio/layout.tsx` | Auth guard |
| `LanguageSwitcher` | RTL/language support |
| shadcn components | All form inputs, selectors, dialogs |

## New Files

| File | Purpose |
|------|---------|
| `src/app/studio/simple/page.tsx` | Server component entry |
| `src/app/studio/simple/SimpleStudioClient.tsx` | Client component shell |
| `src/components/simple-studio/Sidebar.tsx` | Mode tabs + morphing form |
| `src/components/simple-studio/ResultsGallery.tsx` | Batch results grid |
| `src/components/simple-studio/PromptLibrary.tsx` | Public + private prompt browsing |
| `src/components/simple-studio/GenerationCard.tsx` | Single result card |
| `src/store/simpleStudioStore.ts` | Zustand store |
| `src/lib/simple-studio/promptTemplates.ts` | Seeded public prompt data |
| `src/app/api/studio/prompts/route.ts` | Prompts list + create |
| `src/app/api/studio/prompts/public/route.ts` | Public prompt library |
| `src/app/api/studio/prompts/[promptId]/route.ts` | Prompt update + delete |
| Drizzle migration | `saved_prompts` table |

## Modified Files (Minimal)

| File | Change |
|------|--------|
| `src/components/Header.tsx` | Add mode switcher pill (Simple / Workflow) |
| `src/lib/db/schema.ts` | Add `savedPrompts` table definition |
| `src/lib/studio/repository.ts` | Add prompt CRUD functions |

## Post-MVP Additions

- User-submitted public prompts (moderation + approval flow)
- Additional modes: product photography, clothing try-on, UGC
- Prompt history (auto-save every generation's prompt for quick re-use)
- Favorites / collections for generated results
- "Open in Workflow" — materialize a simple mode config as a node graph for advanced editing
