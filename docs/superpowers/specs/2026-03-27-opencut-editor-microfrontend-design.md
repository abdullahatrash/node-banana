# OpenCut Video Editor — Microfrontend Integration Design

**Date:** 2026-03-27
**Status:** Approved
**Scope:** Phase 1 — Minimal integration (shared auth + feature flags + navigation)

## Summary

Integrate an OpenCut fork as a Vercel microfrontend served at `/editor` within Node Banana's domain. The editor remains a standalone Next.js app with its own IndexedDB storage. Integration is limited to shared authentication, feature flag gating, and pillar navigation. This gives users a video editing capability alongside the existing AI Studio and Social Hub pillars without deep coupling.

### User Journey

```
/studio (Create)  →  /editor (Refine)  →  /social (Publish)
   AI-generate        Trim, combine,        Schedule & post
   images/videos      add text, render       to channels
```

Asset transfer between pillars is manual in Phase 1 (download from media pool → import into editor → export → upload to social). Seamless R2 integration is deferred to Phase 2.

## Architecture

### System Diagram

```
banana.app (single domain, Vercel edge)
│
│  microfrontends.json routes:
│  ├── /editor/*  ──→  opencut-editor (child microfrontend)
│  └── everything else ──→  node-banana (default app)
│
├── node-banana (Default App) ─── Vercel Project
│   ├── /                     Landing / sign-in / sign-up
│   ├── /studio               AI workflow editor
│   ├── /social/*             Social media hub
│   ├── /dashboard            Analytics
│   ├── /api/auth/[...all]    Better Auth (auth authority)
│   └── middleware.ts          Feature flag routing for /editor/*
│
├── opencut-editor (Child App) ─── Vercel Project (fork)
│   ├── /editor/projects      Project list (auth-gated)
│   ├── /editor/[project_id]  Video editor (auth-gated)
│   └── IndexedDB             Local project + media storage
│
└── Shared Infrastructure
    ├── PostgreSQL             Auth tables (users, sessions, accounts, verifications)
    └── Same domain cookie     Session shared across both apps
```

### How Vercel Microfrontends Work

- `microfrontends.json` lives in the default app (node-banana) and declares route ownership
- Vercel's edge reads this config and routes requests to the correct project within the same request — no rewrite, no extra hop
- Each app has its own build, deploy, and JS/CSS bundles
- `@vercel/microfrontends` package adds asset prefixes so JS/CSS from each app don't collide
- A local dev proxy routes between apps during development

## Detailed Design

### 1. Microfrontends Configuration

**File:** `microfrontends.json` (root of node-banana repo)

```json
{
  "$schema": "https://openapi.vercel.sh/microfrontends.json",
  "applications": {
    "node-banana": {
      "development": {
        "fallback": "https://banana.app"
      }
    },
    "opencut-editor": {
      "routing": [
        {
          "flag": "editor-enabled",
          "paths": ["/editor/:path*"]
        }
      ]
    }
  },
  "options": {
    "localProxyPort": 3024
  }
}
```

- `node-banana` is the default app — handles all routes not claimed by a child
- `opencut-editor` claims `/editor/:path*`
- The `flag: "editor-enabled"` gates access — when the flag returns false, the request stays in node-banana where middleware can show an upgrade/paywall page
- `localProxyPort` gives a predictable local dev URL

### 2. Shared Authentication

**Principle:** Node Banana is the auth authority. OpenCut reads from the same database and trusts the same session cookie.

**Shared environment variables (both Vercel projects):**

| Variable | Value | Purpose |
|----------|-------|---------|
| `DATABASE_URL` | Same Postgres connection string | Shared auth tables |
| `BETTER_AUTH_SECRET` | Same secret | Session cookie signing |
| `BETTER_AUTH_URL` | `https://banana.app` | Auth base URL |
| `NEXT_PUBLIC_APP_URL` | `https://banana.app` | Client-side auth URL |

**Why cookies work across both apps:**
Both apps are served from the same domain (`banana.app`). The Better Auth session cookie is set on that domain. When the browser hits `/editor/*`, Vercel routes to the OpenCut app, but the cookie is sent because the domain matches. OpenCut validates the session against the same Postgres database.

**Schema alignment:**

Node Banana's auth schema (with organization plugin) is a superset of OpenCut's:

| Table | Node Banana | OpenCut | Conflict? |
|-------|------------|---------|-----------|
| `users` | Yes | Yes | No — same structure |
| `sessions` | Yes | Yes | No — same structure |
| `accounts` | Yes | Yes | No — same structure |
| `verifications` | Yes | Yes | No — same structure |
| `organizations` | Yes (plugin) | No | No — OpenCut ignores it |
| `members` | Yes (plugin) | No | No — OpenCut ignores it |
| `invitations` | Yes (plugin) | No | No — OpenCut ignores it |
| `workspaces` | Yes (custom) | No | No — OpenCut ignores it |

**Action:** Upgrade OpenCut fork's Better Auth from 1.2.7 → 1.5.5 to match Node Banana. Remove OpenCut's Drizzle migration files for auth tables (Node Banana owns the schema). OpenCut's auth server config only needs to read sessions — it does not run migrations.

### 3. Feature Flag Gating

**Goal:** Gate `/editor` access based on user plan. Users without the feature see an upgrade page.

**Node Banana middleware** (new file: `middleware.ts` at project root):

```typescript
import type { NextRequest } from "next/server";
import { runMicrofrontendsMiddleware } from "@vercel/microfrontends/next/middleware";

export async function middleware(request: NextRequest) {
  const response = await runMicrofrontendsMiddleware({
    request,
    flagValues: {
      "editor-enabled": async () => {
        // Phase 1: return true for all authenticated users
        // Phase 2: check user plan from DB/session
        return true;
      },
    },
  });
  if (response) return response;
}

export const config = {
  matcher: [
    "/.well-known/vercel/microfrontends/client-config",
    "/editor/:path*",
  ],
};
```

Phase 1 returns `true` for all users. When billing is implemented, this function checks the user's plan and returns `false` for users without editor access — the request then stays in Node Banana where a `/editor` catch-all page shows an upgrade prompt.

**Upgrade page** (new file in node-banana: `src/app/editor/page.tsx`):

A simple page that shows "Video Editor is available on Pro plan" with an upgrade CTA. This page only renders when the feature flag returns false (request stays in node-banana instead of routing to opencut-editor).

### 4. OpenCut Fork — Changes Required

Minimal changes to keep upstream merging easy:

#### 4a. Next.js Config — Add microfrontends wrapper

```typescript
// next.config.ts
import { withMicrofrontends } from "@vercel/microfrontends/next/config";

const nextConfig = {
  // ... existing OpenCut config
};

export default withMicrofrontends(nextConfig);
```

`withMicrofrontends` adds an asset prefix so JS/CSS bundles are served under a unique path (e.g., `/vc-ap-<hash>/`) and don't collide with Node Banana's assets.

#### 4b. Auth Gating — Add to editor layout

OpenCut currently has **no auth checks** on `/editor/*`. Add a layout-level gate:

```typescript
// src/app/editor/layout.tsx (new file in OpenCut fork)
import { auth } from "@/lib/auth/server";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

export default async function EditorLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth.api.getSession({
    headers: await headers(),
  });

  if (!session?.user) {
    redirect("/sign-in");
  }

  return <>{children}</>;
}
```

Since `/sign-in` is handled by Node Banana (the default app), the redirect naturally goes to the right place — Vercel routes non-`/editor` paths to node-banana.

#### 4c. Route Restructuring

| Current OpenCut Route | New Route | Action |
|----------------------|-----------|--------|
| `/` | Remove | Landing page not needed |
| `/editor/[project_id]` | `/editor/[project_id]` | Keep as-is |
| `/projects` | `/editor/projects` | Move to `/editor/projects` |
| `/blog`, `/changelog`, `/contributors` | Remove | Marketing pages not needed |
| `/sign-in`, `/sign-up` | Remove or redirect to `/sign-in` | Auth lives in node-banana |

**Implementation:** Delete unnecessary route directories. Move `/projects` page into `/editor/projects/page.tsx`.

#### 4d. Pillar Navigation Header

Add a navigation header to OpenCut's editor layout so users can navigate between pillars:

```typescript
// src/components/editor/pillar-header.tsx (new file in OpenCut fork)
const PILLAR_ITEMS = [
  { href: "/studio", label: "AI Studio" },
  { href: "/editor/projects", label: "Video Editor" },
  { href: "/social", label: "Social Hub" },
];
```

Navigation uses `window.location.href` (full page reload) since cross-microfrontend navigation cannot be SPA. This matches Node Banana's existing pillar switcher behavior.

#### 4e. Remove Unused Dependencies

OpenCut includes dependencies not needed for the editor-only deployment:

- `@upstash/redis`, `@upstash/ratelimit` — rate limiting (Node Banana handles this)
- `postgres`, `pg` — only needed if OpenCut writes to DB (it won't in Phase 1 beyond reading sessions)
- Blog/CMS dependencies (`content-collections`, Marble CMS)
- Analytics (`@vercel/analytics`, databuddy)

Keep: `better-auth` (for session reading), `drizzle-orm` (for session queries).

#### 4f. Better Auth Version Upgrade

Upgrade from `better-auth@1.2.7` to `better-auth@1.5.5` to match Node Banana. This ensures session token format and cookie handling are compatible.

### 5. Node Banana — Changes Required

#### 5a. Install microfrontends package

```bash
pnpm add @vercel/microfrontends
```

#### 5b. Add microfrontends.json

As specified in section 1.

#### 5c. Wrap next.config.ts

```typescript
import { withMicrofrontends } from "@vercel/microfrontends/next/config";

const nextConfig = {
  // ... existing config
};

export default withMicrofrontends(nextConfig);
```

#### 5d. Add middleware.ts

As specified in section 3.

#### 5e. Update Pillar Navigation

Add "Video Editor" to pillar items in:

- `src/components/social/PillarSwitcher.tsx` — add `{ id: "editor", label: "Video Editor", href: "/editor/projects" }`
- `src/components/social/SocialAppSidebar.tsx` — add to `PILLAR_ITEMS`
- Any other sidebar/header that lists pillars

#### 5f. Add Editor Upgrade Page

```
src/app/editor/page.tsx — "Upgrade to access Video Editor" (shown when flag is false)
```

#### 5g. Dev script updates

Update `package.json` dev script to use microfrontends port:

```json
{
  "scripts": {
    "dev": "next dev --port $(microfrontends port)",
    "proxy": "microfrontends proxy --local-apps node-banana"
  }
}
```

### 6. Vercel Deployment Setup

#### Two Vercel Projects

| Setting | node-banana | opencut-editor |
|---------|-------------|----------------|
| Repo | node-banana | opencut-fork |
| Framework | Next.js | Next.js |
| Role | Default app | Child microfrontend |
| Build command | `pnpm build` | `bun run build` |
| Root directory | `/` | `apps/web` |

#### Microfrontends Group

Create via Vercel CLI or dashboard:
```bash
vercel microfrontends create-group
```

Add both projects to the group. Set `node-banana` as the default application.

#### Shared Environment Variables

Both projects need these env vars configured in Vercel dashboard:

```
DATABASE_URL=<shared postgres connection>
BETTER_AUTH_SECRET=<same secret>
BETTER_AUTH_URL=https://banana.app
NEXT_PUBLIC_APP_URL=https://banana.app
```

### 7. Local Development

#### Option A: Run both apps with proxy

```bash
# Terminal 1: Node Banana
cd node-banana
pnpm dev

# Terminal 2: OpenCut fork
cd opencut-fork/apps/web
bun dev --port $(microfrontends port)

# Terminal 3: Proxy
cd node-banana
pnpm proxy
# Visit http://localhost:3024
```

#### Option B: Run one app, proxy falls back to production

```bash
# Only working on Node Banana
cd node-banana
pnpm dev
pnpm proxy
# /editor/* falls back to production OpenCut deployment
```

#### Polyrepo Configuration

Since these are separate repos, each OpenCut fork developer needs:

```bash
# Pull microfrontends.json from Vercel
vercel microfrontends pull

# Or set env var pointing to local copy
export VC_MICROFRONTENDS_CONFIG=/path/to/node-banana/microfrontends.json
```

### 8. What Stays Untouched in OpenCut

| Component | Status |
|-----------|--------|
| EditorCore singleton + 10 managers | Untouched |
| All editor UI components (70+) | Untouched |
| IndexedDB storage (projects + media) | Untouched |
| Canvas + WebGL rendering pipeline | Untouched |
| mediabunny export | Untouched |
| Zustand stores (8 stores) | Untouched |
| Keybindings system | Untouched |
| Timeline, playback, audio | Untouched |
| Command pattern (undo/redo) | Untouched |

### 9. Risk Mitigation

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Better Auth version mismatch | High | Session incompatibility | Upgrade OpenCut to 1.5.5 before any other work |
| Asset prefix breaks OpenCut's `public/` assets | Medium | Broken images/fonts/FFmpeg | `withMicrofrontends` handles JS/CSS. Manually verify `public/` assets load correctly; move to prefixed subdirectory if needed |
| OpenCut's Bun vs Node Banana's pnpm | Low | None — separate repos | Each repo uses its own package manager independently |
| Upstream OpenCut merge conflicts | Low | Minor — changes are isolated | Keep fork changes in clearly separated files (layout, header, config). Don't modify core editor code |
| Cross-app navigation feels jarring | Medium | UX friction on pillar switch | Full reload is already the pattern in Node Banana's pillar switcher. Consistent behavior. |
| Vercel microfrontends pricing | Low | Cost on Pro plan | Usage-based; monitor in Vercel dashboard |

## Phase 2 — Future Enhancements (Not in Scope)

These are explicitly deferred. Documenting them so future work has context:

- **R2 storage adapter** — Replace IndexedDB with R2-backed storage for seamless asset flow between pillars
- **"Send to Editor" button** — In Studio/Social, one-click open assets in editor
- **"Publish" button** — In Editor, export directly to Social compose
- **Server-side project persistence** — Save editor projects to Postgres + R2
- **Shared design system** — Extract common UI components into shared package
- **Billing integration** — Connect feature flag to actual payment/plan data
- **Prefetch optimizations** — Faster cross-app navigation via microfrontends prefetching
