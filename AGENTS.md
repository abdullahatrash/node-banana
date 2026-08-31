# AGENTS.md

This file provides guidance to Codex (Codex.ai/code) when working with code in this repository.

## Build & Development Commands

```bash
pnpm dev      # Start Next.js dev server at http://localhost:3000
pnpm build    # Build for production
pnpm start    # Start production server
pnpm lint     # Run Next.js linting
pnpm test     # Run all tests with Vitest (watch mode)
pnpm test:run # Run all tests once (CI mode)
```

## Environment Setup

Create `.env.local` in the root directory:
```
GEMINI_API_KEY=your_gemini_api_key
OPENAI_API_KEY=your_openai_api_key  # Optional, for OpenAI LLM provider
KIE_API_KEY=your_kie_api_key        # Optional, for Kie.ai models (Sora, Veo, Kling, etc.)
```

## Architecture Overview

Node Banana is pivoting into an Arabic-first content creation and publishing product for the MENA region. The legacy React Flow visual workflow editor has been retired. The product now centers on focused image, video, and copy generation forms, workspace media, social publishing, and a separate video editor.

### Core Stack
- **Next.js 16** (App Router) with TypeScript
- **Zustand** for client state management
- **Better Auth + Postgres** for authentication and workspace data
- **Provider adapters** for Gemini, OpenAI, Replicate, fal.ai, Kie.ai, and WaveSpeed

### Key Files

| Purpose | Location |
|---------|----------|
| Form-driven generation state | `src/store/simpleStudioStore.ts` |
| Social composer state | `src/store/socialComposerStore.ts` |
| Social calendar state | `src/store/socialCalendarStore.ts` |
| All TypeScript type definitions | `src/types/index.ts` |
| Image generation API route | `src/app/api/generate/route.ts` |
| LLM text generation API route | `src/app/api/llm/route.ts` |
| Model discovery and schemas | `src/app/api/models/` |
| Workspace asset APIs | `src/app/api/studio/assets/` |
| Social provider integrations | `src/lib/social/providers/` |

### Product Surfaces

- `/` — public marketing entry point
- `/simple-studio/*` — authenticated image, video, and copy generation
- `/editor/*` — separate short-form video editor
- `/social/*` — channels, composer, media, calendar, publishing, and analytics
- `/api/generate`, `/api/llm`, `/api/models/*` — reusable generation infrastructure
- `/api/studio/assets/*` — workspace media storage and delivery

## AI Models

Image generation models (these exist and are recently released):
- `gemini-2.5-flash-image` → internal name: `nano-banana`
- `gemini-3-pro-image-preview` → internal name: `nano-banana-pro`

LLM models:
- Google: `gemini-2.5-flash`, `gemini-3-flash-preview`, `gemini-3-pro-preview`
- OpenAI: `gpt-4.1-mini`, `gpt-4.1-nano`

## Adding New Kie.ai Models (SOP)

Reference docs: https://docs.kie.ai/llms.txt lists all available model API pages.

### Step 1: Gather API Details
Visit the model's doc page on https://docs.kie.ai/ and collect:
- Model ID(s) (the `model` param sent to the API)
- Capabilities: text-to-image, image-to-image, text-to-video, image-to-video
- API endpoint (standard: `/api/v1/jobs/createTask`, or model-specific like Veo's `/api/v1/veo/generate`)
- All input parameters: name, type, enum values, defaults, required status
- Image/video input parameter name (e.g., `image_urls`, `imageUrls`, `input_urls`)
- Polling endpoint (standard: `/api/v1/jobs/recordInfo`, or model-specific)
- Response format and status field names
- Pricing (per-run cost if available)

### Step 2: Add Model Registry Entry
**File:** `src/app/api/models/route.ts` — Add to `KIE_MODELS` array.
Each model entry needs: `id`, `name`, `description`, `provider: "kie"`, `capabilities`, `pricing`, `pageUrl`.
Use separate entries for each capability variant (e.g., `model/text-to-video` and `model/image-to-video`).

### Step 3: Add Parameter Schema
**File:** `src/app/api/models/[modelId]/route.ts` — Add to `getKieSchema()`.
Define `parameters` (user-configurable settings) and `inputs` (form inputs such as prompt and images).

### Step 4: Add Default Parameters
**File:** `src/app/api/generate/route.ts` — Add case to `getKieModelDefaults()`.
Provide required defaults that must be present even if the user doesn't set them.

### Step 5: Add Image Input Key Mapping
**File:** `src/app/api/generate/route.ts` — Add to `getKieImageInputKey()`.
Map the model to its correct image parameter name if it differs from the default `image_urls`.

### Step 6: Handle Non-Standard API (if applicable)
If the model uses different endpoints than `/api/v1/jobs/createTask` and `/api/v1/jobs/recordInfo`:
- Add a detection function (e.g., `isVeoModel()`)
- Add a model-ID-to-API-model mapping function
- Add a custom polling function for the model's status endpoint
- Add a branch in `generateWithKie()` for the custom request format

## API Routes

All routes in `src/app/api/`:

| Route | Timeout | Purpose |
|-------|---------|---------|
| `/api/generate` | 5 min | Image generation via Gemini |
| `/api/llm` | 1 min | Text generation (Google/OpenAI) |
| `/api/models` | default | Discover available generation models |
| `/api/studio/assets` | default | List and record workspace media |

## localStorage Keys

- `node-banana-active-workspace-id` - Active workspace selection
- `node-banana-provider-settings` - Locally stored provider configuration

## Git Workflow

- The primary development branch is `develop`, NOT `main` or `master`
- Always checkout `develop` before creating feature branches: `git checkout develop`
- Create feature branches from `develop` using: `feature/<short-description>` or `fix/<short-description>`
- All PRs MUST target `develop`: use `gh pr create --base develop`
- Never push directly to `main`, `master`, or `develop`

## Commits
- Commit after each logical task or unit of work is complete. When implementing a multi-task plan, commit after finishing each task — do NOT batch all tasks into a single commit at the end.
- Each commit should be atomic and self-contained: one task = one commit.
- The .planning directory is untracked, do not attempt to commit any changes to the files in this directory.
