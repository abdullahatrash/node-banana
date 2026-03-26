# CLAUDE.local.md

## About me

- Core contributor — familiar with most of the stack (Next.js, React Flow, Zustand, Drizzle, Better Auth, R2 for S3)
- When making decisions,d briefly explain traeoffs and what alternatives exist

### Core Stack
- **Next.js 16** (App Router) with TypeScript, custom `server.js` for extended request timeouts
- **@xyflow/react** (React Flow) for the node editor canvas
- **Konva.js / react-konva** for canvas annotation drawing
- **Zustand** for state management (single store pattern)
- **Drizzle ORM** with PostgreSQL 16 for persistence (auth, workspaces, assets)
- **Better Auth** for authentication (magic link, OAuth, 2FA, organizations)
- **Cloudflare R2 onject storage with AWS S3 compataibbl Api** for asset storage with presigned URLs

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

