# Node Banana

> **Important note:** This is in early development, it probably has some issues. Use Chrome. For support or raising any issues join the [discord](https://discord.com/invite/89Nr6EKkTf). See the [docs](https://node-banana-docs.vercel.app/) for help, installation guides, and user guides.

Node Banana is node-based workflow application for generating images with Nano Banana Pro. Build image generation pipelines by connecting nodes on a visual canvas. Recent Fal and Replicate integration allows for complex image and video pipelines from any provider, but be aware this is still in testing. 

Built mainly with Opus 4.5.

![Node Banana Screenshot](public/node-banana.png)

## Features

- **Prompt to Workflow** - Generate complete workflows from natural language descriptions or choose from preset templates (Gemini only for now)
- **Visual Node Editor** - Drag-and-drop nodes onto an infinite canvas with pan and zoom
- **Image Annotation** - Full-screen editor with drawing tools (rectangles, circles, arrows, freehand, text)
- **AI Image Generation** - Generate images using Google Gemini models
- **Text Generation** - Generate text using Google Gemini or OpenAI models
- **Workflow Chaining** - Connect multiple nodes to create complex pipelines
- **Save/Load Workflows** - Export and import workflows as JSON files
- **Group Locking** - Lock node groups to skip them during execution

## Multi-Provider Support (Beta)

In addition to Google Gemini, Node Banana now supports:
- **Replicate** - Access thousands of open-source models
- **fal.ai** - Fast inference for image and video generation

Configure API keys in Project Settings to enable these providers.

## Tech Stack

- **Framework**: Next.js 16 (App Router)
- **Language**: TypeScript
- **Node Editor**: @xyflow/react (React Flow)
- **Canvas**: Konva.js / react-konva
- **State Management**: Zustand
- **Styling**: Tailwind CSS
- **AI**: Google Gemini API, OpenAI API, Replicate (Beta), fal.ai (Beta)

## Getting Started

### Prerequisites

- Node.js 18+
- pnpm (recommended via Corepack)

### Environment Variables

Create a `.env.local` file in the root directory:

```env
GEMINI_API_KEY=your_gemini_api_key
OPENAI_API_KEY=your_openai_api_key      # Optional, for OpenAI LLM provider
REPLICATE_API_KEY=your_replicate_api_key  # Optional, beta
FAL_API_KEY=your_fal_api_key              # Optional, beta
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/node_banana
BETTER_AUTH_SECRET=change_this_to_a_long_random_secret
BETTER_AUTH_URL=http://localhost:3000
NEXT_PUBLIC_BETTER_AUTH_URL=http://localhost:3000
# Optional extra trusted origins (comma-separated), useful for local 127.0.0.1/IP URLs
BETTER_AUTH_TRUSTED_ORIGINS=http://127.0.0.1:3000
# Optional local-only auth bypass for AI Studio routes.
# Keep false in production.
DEV_AUTH_BYPASS=false
DEV_USER_ID=local-user
DEV_WORKSPACE_ID=local-workspace
# Optional S3-compatible asset storage ("s3" means S3 API compatible, not AWS-only)
STORAGE_BACKEND=local                      # or "s3"

# Recommended Cloudflare R2 defaults when STORAGE_BACKEND=s3
S3_BUCKET_NAME=your_bucket_name
S3_REGION=auto
S3_ENDPOINT=https://<ACCOUNT_ID>.r2.cloudflarestorage.com
S3_ACCESS_KEY_ID=
S3_SECRET_ACCESS_KEY=
S3_FORCE_PATH_STYLE=false                  # R2 default
```

For non-development environments, `BETTER_AUTH_SECRET` is required and you must provide either `BETTER_AUTH_URL` or `NEXT_PUBLIC_APP_URL` so auth origin validation works correctly.

Better Auth client defaults to same-origin when `NEXT_PUBLIC_BETTER_AUTH_URL`/`NEXT_PUBLIC_APP_URL` are not set. In development, `localhost` and `127.0.0.1` are trusted automatically; use `BETTER_AUTH_TRUSTED_ORIGINS` for any additional local origins.

AI Studio bypass is local-only (`DEV_AUTH_BYPASS=true`) and is ignored in production.

For browser presigned uploads (S3/R2 mode), configure bucket CORS to allow your app origin(s), methods `PUT/GET/HEAD`, and `Content-Type` headers.

### Local Postgres (Docker)

Start local Postgres:

```bash
pnpm db:up
```

Generate and apply migrations:

```bash
pnpm db:generate
pnpm db:migrate
```

Stop local Postgres:

```bash
pnpm db:down
```

### Installation

```bash
pnpm install
```

### Development

```bash
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

### Auth + Route Behavior

- `/` is a public home/auth landing page (sign in/up actions).
- `/studio` is protected and redirects unauthenticated users to `/sign-in`.
- Auth sessions are handled through Better Auth (`/api/auth/*`) with Postgres-backed persistence when `DATABASE_URL` is configured.

### Infra Smoke (Gate A)

Prerequisites:

1. Start Postgres: `pnpm db:up`
2. Run migrations: `pnpm db:migrate`
3. Seed local users/workspaces: `pnpm db:seed`

Run smoke validation (local metadata mode):

```bash
pnpm smoke:infra
```

Run smoke validation (S3-compatible presign/upload/finalize mode):

```bash
SMOKE_STORAGE_MODE=s3 pnpm smoke:infra
```

S3 mode requires `STORAGE_BACKEND=s3` plus valid `S3_BUCKET_NAME`, `S3_REGION`, `S3_ENDPOINT`, `S3_ACCESS_KEY_ID`, and `S3_SECRET_ACCESS_KEY`.

Expected pass output includes:

- `auth health check`
- `sign-in with seeded user`
- `workspace list`
- `project create/list/open/delete (soft)`
- `asset create/list/delete (soft)` in local mode
- `asset presign/upload/finalize/list/delete (soft)` in s3 mode

Phase 6 verification commands:

```bash
pnpm test:gate-a
pnpm smoke:infra
SMOKE_STORAGE_MODE=s3 pnpm smoke:infra
```

### Build

```bash
pnpm build
pnpm start
```

## Example Workflows

The `/examples` directory contains some example workflow files from my personal projects. To try them:

1. Start the dev server with `pnpm dev`
2. Drag any `.json` file from the `/examples` folder into the browser window
3. Make sure you review each of the prompts before starting, these are fairly targetted to the examples. 

## Usage

1. **Add nodes** - Click the floating action bar to add nodes to the canvas
2. **Connect nodes** - Drag from output handles to input handles (matching types only)
3. **Configure nodes** - Adjust settings like model, aspect ratio, or drawing tools
4. **Run workflow** - Click the Run button to execute the pipeline
5. **Save/Load** - Use the header menu to save or load workflows

## Connection Rules

- **Image** handles connect to **Image** handles only
- **Text** handles connect to **Text** handles only
- Image inputs on generation nodes accept multiple connections
- Text inputs accept single connections

## Testing

Run the test suite with:

```bash
pnpm test              # Watch mode
pnpm test:run          # Single run
pnpm test:gate-a       # Gate A deterministic API/auth regression suite
pnpm test:coverage     # With coverage report
```

## Contributions
PRs are welcome, please pull the latest changes from develop before creating a PR and make it to the develop branch, not master. Not that I'm primarily making this for my own workflows, if the PR conflicts with my own plans I'll politely reject it. If you want to collaborate, consider joining the Discord and we can hash something out. 

## License

MIT
