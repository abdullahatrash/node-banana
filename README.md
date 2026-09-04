# Node Banana

> **Important note:** This is in early development, it probably has some issues. Use Chrome. For support or raising any issues join the [discord](https://discord.com/invite/89Nr6EKkTf). See the [docs](https://node-banana-docs.vercel.app/) for help, installation guides, and user guides.

Node Banana is becoming an Arabic-first content creation and publishing product for the MENA region. The current application combines a form-driven AI content studio, reusable media library, video editor, social composer, calendar, publishing integrations, and analytics infrastructure.

Built mainly with Opus 4.5.

![Node Banana Screenshot](public/node-banana.png)

## Features

- **Content Studio** - Generate images, videos, and copy from focused forms
- **Media Library** - Keep generated and uploaded workspace assets together
- **Video Editor** - Edit short-form video in a dedicated experience
- **Social Publishing** - Compose, schedule, publish, and track content across channels
- **Multi-Provider Generation** - Use Gemini, OpenAI, Replicate, fal.ai, Kie.ai, and WaveSpeed models
- **Arabic-First Foundation** - RTL and locale infrastructure for the MENA-focused product

## Multi-Provider Support (Beta)

In addition to Google Gemini, Node Banana now supports:
- **Replicate** - Access thousands of open-source models
- **fal.ai** - Fast inference for image and video generation

Configure provider API keys in the relevant content experience.

## Tech Stack

- **Framework**: Next.js 16 (App Router)
- **Language**: TypeScript
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
# Optional staged auth features (all false by default)
BETTER_AUTH_ENABLE_GOOGLE_OAUTH=false
BETTER_AUTH_ENABLE_GITHUB_OAUTH=false
BETTER_AUTH_ENABLE_MAGIC_LINK=false
BETTER_AUTH_ENABLE_TWO_FACTOR=false
# Google/GitHub OAuth credentials (required only when corresponding feature is enabled)
BETTER_AUTH_GOOGLE_CLIENT_ID=
BETTER_AUTH_GOOGLE_CLIENT_SECRET=
BETTER_AUTH_GITHUB_CLIENT_ID=
BETTER_AUTH_GITHUB_CLIENT_SECRET=
# Optional client-side feature toggles for auth UI/client plugin wiring
NEXT_PUBLIC_BETTER_AUTH_ENABLE_MAGIC_LINK=false
NEXT_PUBLIC_BETTER_AUTH_ENABLE_TWO_FACTOR=false
# Optional extra trusted origins (comma-separated), useful for local 127.0.0.1/IP URLs
BETTER_AUTH_TRUSTED_ORIGINS=http://127.0.0.1:3000
# Optional local-only auth bypass for authenticated app routes.
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
For production/staging-like deployments, `DATABASE_URL` is required for Better Auth (memory adapter fallback is local-only).

Verified email signup and the Arabic-first onboarding rollout also require the `AUTH_*`, `RESEND_*`, and `ONBOARDING_*` values documented in [`.env.example`](.env.example). Apply the onboarding migrations and legacy backfill in the order described by [`docs/onboarding-rollout.md`](docs/onboarding-rollout.md) before enabling product gates.

### Marketing and product domains

Attach the marketing apex/`www` domain and the `app` subdomain to the same deployment, then configure:

```bash
NEXT_PUBLIC_MARKETING_URL=https://your-domain.com
NEXT_PUBLIC_APP_URL=https://app.your-domain.com
BETTER_AUTH_URL=https://app.your-domain.com
NEXT_PUBLIC_BETTER_AUTH_URL=https://app.your-domain.com
```

The marketing origin serves `/`. Product UI paths are permanently redirected to the app origin, and the app origin redirects `/` to `/simple-studio/images`. API routes remain reachable without host redirects so OAuth callbacks, webhooks, and scheduled infrastructure calls are not disrupted.

Bare `http://localhost:3000` stays in single-origin mode. To exercise the split locally, use `http://www.localhost:3000` and `http://app.localhost:3000` and set the two public URL variables accordingly.

Better Auth client defaults to same-origin when `NEXT_PUBLIC_BETTER_AUTH_URL`/`NEXT_PUBLIC_APP_URL` are not set. In development, `localhost` and `127.0.0.1` are trusted automatically; use `BETTER_AUTH_TRUSTED_ORIGINS` for any additional local origins.

The development auth bypass is local-only (`DEV_AUTH_BYPASS=true`) and is ignored in production.

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
pnpm db:backfill:org
```

Stop local Postgres:

```bash
pnpm db:down
```

### Local PostgreSQL + canonical media storage

Real image and video generation must copy provider output into Workspace-owned
S3-compatible storage before an operation can succeed. Start PostgreSQL and the
included MinIO service together:

```bash
pnpm infra:up
```

Use this local-only profile in `.env.local`:

```env
STORAGE_BACKEND=s3
S3_BUCKET_NAME=node-banana
S3_REGION=us-east-1
S3_ENDPOINT=http://localhost:9000
S3_ACCESS_KEY_ID=node-banana-local
S3_SECRET_ACCESS_KEY=node-banana-local-secret
S3_FORCE_PATH_STYLE=true
```

MinIO serves the S3 API at `http://localhost:9000` and its local console at
`http://localhost:9001`. The initializer creates the bucket idempotently and
allows browser uploads from the documented local app origins only. These
development credentials must never be reused outside the local Docker stack.

Validate the complete auth, Workspace, presigned upload, finalize, list, and
delete lifecycle after the app is running:

```bash
APP_BASE_URL=http://localhost:3002 SMOKE_STORAGE_MODE=s3 pnpm smoke:infra
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
- `/simple-studio` is protected and redirects unauthenticated users to `/sign-in`.
- `/editor` remains the dedicated video-editing surface.
- `/social` contains composition, scheduling, publishing, and analytics surfaces.
- Auth sessions are handled through Better Auth (`/api/auth/*`) with Postgres-backed persistence when `DATABASE_URL` is configured.
- Workspace/organization hybrid mapping is stored in `workspace_settings` with Better Auth organization plugin tables (`organization`, `member`, `invitation`).

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

Workspace quota enforcement (Phase 6b):

- Default quota is `10 GB` per workspace (DB-managed, not env-managed).
- Presign requests reserve quota using `expectedSizeBytes`; uploads are blocked with `403` when projected usage exceeds quota.
- Override quota for one workspace via script:

```bash
pnpm db:set-workspace-quota -- <workspace_id> 20gb
```

Expected pass output includes:

- `auth health check`
- `sign-in with seeded user`
- `workspace list`
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

## Usage

1. Open the content studio at `/simple-studio/images`, `/simple-studio/videos`, or `/simple-studio/copy`.
2. Choose a model, add a prompt and source media, then generate.
3. Reuse results from the media library or attach them in the social composer.
4. Schedule approved content from the social calendar.

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
