# OpenCut Video Editor Microfrontend — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Serve an OpenCut fork as a Vercel microfrontend at `/editor` within Node Banana, with shared auth, feature flag gating, and pillar navigation.

**Architecture:** Node Banana is the default Vercel microfrontend app. An OpenCut fork is a child microfrontend routed at `/editor/*` via `microfrontends.json`. Both apps share a Postgres database for auth (Better Auth) and a domain for cookie sharing. Feature flags in Node Banana's middleware gate access to the editor.

**Tech Stack:** Next.js 16, Vercel Microfrontends (`@vercel/microfrontends`), Better Auth, Drizzle ORM, PostgreSQL, Zustand, bun (OpenCut), pnpm (Node Banana)

**Spec:** `docs/superpowers/specs/2026-03-27-opencut-editor-microfrontend-design.md`

---

## File Map

### Node Banana (default app) — Files to create

| File | Responsibility |
|------|---------------|
| `microfrontends.json` | Route config — declares opencut-editor owns `/editor/*` with feature flag |
| `middleware.ts` | Microfrontends middleware — evaluates `editor-enabled` flag, routes to child or shows upgrade page |
| `src/app/editor/page.tsx` | Upgrade/paywall page — shown when feature flag returns false |

### Node Banana — Files to modify

| File | Change |
|------|--------|
| `package.json` | Add `@vercel/microfrontends` dependency, add `proxy` script, update `dev` script |
| `next.config.ts` | Wrap with `withMicrofrontends` |
| `src/components/social/PillarSwitcher.tsx` | Add "Video Editor" to PILLARS array |
| `src/components/social/SocialAppSidebar.tsx` | Add "Video Editor" to PILLAR_ITEMS array |

### OpenCut Fork — Files to create

| File | Responsibility |
|------|---------------|
| `apps/web/src/app/editor/layout.tsx` | Auth gate — redirects unauthenticated users to `/sign-in` |
| `apps/web/src/components/editor/pillar-nav.tsx` | Navigation header — links to Studio, Editor, Social pillars |

### OpenCut Fork — Files to modify

| File | Change |
|------|--------|
| `apps/web/next.config.ts` | Wrap with `withMicrofrontends`, remove `output: "standalone"` |
| `apps/web/package.json` | Add `@vercel/microfrontends`, upgrade `better-auth` to 1.5.5 |
| `apps/web/src/lib/auth/server.ts` | Point to shared DB, remove Upstash rate limiting, align with Node Banana's auth config |
| `apps/web/src/lib/auth/client.ts` | Point `baseURL` to shared app URL |
| `packages/env/src/web.ts` | Relax env validation — remove required vars not needed for editor-only mode |
| `apps/web/src/components/editor/editor-header.tsx` | Update "Exit project" to navigate to `/editor/projects` instead of `/projects` |
| `apps/web/src/app/editor/[project_id]/page.tsx` | No changes (keep as-is) |

### OpenCut Fork — Files/directories to remove

| Path | Reason |
|------|--------|
| `apps/web/src/app/(marketing)/` or root landing routes | Not needed — Node Banana handles landing |
| `apps/web/src/app/blog/`, `changelog/`, `brand/`, `contributors/`, `privacy/`, `roadmap/`, `sponsors/`, `terms/` | Marketing pages not needed |
| `apps/web/src/app/projects/` | Move to `apps/web/src/app/editor/projects/` |
| `apps/web/migrations/` | Node Banana owns DB migrations |

---

## Tasks

### Task 1: Set Up OpenCut Fork Repository

**Context:** Before any code changes, create a fork of OpenCut that you own and can modify freely. This is a one-time repo setup.

**Files:**
- Create: New GitHub repository (opencut-fork or similar)

- [ ] **Step 1: Fork OpenCut**

```bash
cd /Users/neoak/projects
gh repo fork <opencut-org>/OpenCut --clone=false --fork-name opencut-editor
# Or if already forked, ensure you have a local clone:
# git clone <your-fork-url> opencut-editor
```

If you already have the fork at `/Users/neoak/projects/OpenCut`, you can work directly on a branch there.

- [ ] **Step 2: Create integration branch**

```bash
cd /Users/neoak/projects/OpenCut
git checkout -b feature/microfrontend-integration
```

- [ ] **Step 3: Commit**

```bash
git commit --allow-empty -m "chore: start microfrontend integration branch"
```

---

### Task 2: Configure Node Banana — Microfrontends JSON

**Context:** The `microfrontends.json` file in the default app tells Vercel's edge which paths belong to which child app. This must exist in the default app's repo root.

**Files:**
- Create: `/Users/neoak/projects/node-banana/microfrontends.json`

- [ ] **Step 1: Create microfrontends.json**

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

Note: Replace `https://banana.app` with your actual production URL when deploying. For now this is a placeholder that only matters when running the proxy locally without the child app.

- [ ] **Step 2: Verify JSON is valid**

Run: `cat /Users/neoak/projects/node-banana/microfrontends.json | python3 -m json.tool`
Expected: Pretty-printed JSON with no errors.

- [ ] **Step 3: Commit**

```bash
cd /Users/neoak/projects/node-banana
git add microfrontends.json
git commit -m "chore: add microfrontends.json for OpenCut editor routing"
```

---

### Task 3: Configure Node Banana — Install Package & Update Config

**Context:** Node Banana needs the `@vercel/microfrontends` package and its `next.config.ts` must be wrapped with `withMicrofrontends` so that asset prefixes are applied correctly.

**Files:**
- Modify: `/Users/neoak/projects/node-banana/package.json`
- Modify: `/Users/neoak/projects/node-banana/next.config.ts`

- [ ] **Step 1: Install the microfrontends package**

Run: `cd /Users/neoak/projects/node-banana && pnpm add @vercel/microfrontends`

- [ ] **Step 2: Update next.config.ts**

The current file chains `withWorkflow`. Add `withMicrofrontends` as the outermost wrapper:

```typescript
import type { NextConfig } from "next";
import { withWorkflow } from "workflow/next";
import { withMicrofrontends } from "@vercel/microfrontends/next/config";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  experimental: {
    serverActions: {
      bodySizeLimit: "50mb",
    },
  },
  turbopack: {
    root: __dirname,
  },
};

export default withMicrofrontends(withWorkflow(nextConfig));
```

- [ ] **Step 3: Update package.json scripts**

Add a `proxy` script for local microfrontend development:

```json
"proxy": "microfrontends proxy --local-apps node-banana"
```

Add this to the `"scripts"` section alongside existing scripts. Do NOT change the existing `"dev"` script — Node Banana uses a custom `server.js` which handles its own port.

- [ ] **Step 4: Verify build still works**

Run: `cd /Users/neoak/projects/node-banana && pnpm build`
Expected: Build succeeds with no errors. The `withMicrofrontends` wrapper should not affect the build in non-microfrontend environments.

- [ ] **Step 5: Commit**

```bash
cd /Users/neoak/projects/node-banana
git add next.config.ts package.json pnpm-lock.yaml
git commit -m "feat: add @vercel/microfrontends and wrap next config"
```

---

### Task 4: Configure Node Banana — Middleware for Feature Flags

**Context:** Vercel microfrontends uses Next.js middleware to evaluate feature flags. When `editor-enabled` returns true, the request routes to the OpenCut child app. When false, it stays in Node Banana where we show an upgrade page.

**Files:**
- Create: `/Users/neoak/projects/node-banana/middleware.ts`
- Create: `/Users/neoak/projects/node-banana/src/app/editor/page.tsx`

- [ ] **Step 1: Create middleware.ts at project root**

```typescript
import type { NextRequest } from "next/server";
import { runMicrofrontendsMiddleware } from "@vercel/microfrontends/next/middleware";

export async function middleware(request: NextRequest) {
  const response = await runMicrofrontendsMiddleware({
    request,
    flagValues: {
      "editor-enabled": async () => {
        // Phase 1: all authenticated users get editor access
        // Phase 2: check user plan from session/DB
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

The `/.well-known/vercel/microfrontends/client-config` matcher is required for prefetch optimizations.

- [ ] **Step 2: Create the upgrade/fallback page**

This page only renders when the feature flag returns `false` (request stays in Node Banana). For Phase 1 the flag always returns `true`, so this page is a placeholder for when billing is added.

```typescript
// src/app/editor/page.tsx
import Link from "next/link";

export default function EditorUpgradePage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-neutral-950">
      <div className="text-center">
        <h1 className="text-2xl font-bold text-white">Video Editor</h1>
        <p className="mt-2 text-neutral-400">
          The video editor is available on Pro plans.
        </p>
        <Link
          href="/studio"
          className="mt-4 inline-block rounded-md bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-500"
        >
          Back to Studio
        </Link>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Verify dev server starts without errors**

Run: `cd /Users/neoak/projects/node-banana && pnpm dev`
Expected: Server starts. Visiting `http://localhost:3000/editor` should show the upgrade page (since the microfrontend child isn't running locally).

- [ ] **Step 4: Commit**

```bash
cd /Users/neoak/projects/node-banana
git add middleware.ts src/app/editor/page.tsx
git commit -m "feat: add microfrontends middleware and editor fallback page"
```

---

### Task 5: Configure Node Banana — Update Pillar Navigation

**Context:** The pillar switcher dropdown and sidebar need a "Video Editor" entry so users can navigate to `/editor/projects` from any pillar.

**Files:**
- Modify: `/Users/neoak/projects/node-banana/src/components/social/PillarSwitcher.tsx` (lines 7-11)
- Modify: `/Users/neoak/projects/node-banana/src/components/social/SocialAppSidebar.tsx` (lines 51-55)

- [ ] **Step 1: Update PillarSwitcher.tsx**

Add the editor pillar to the PILLARS array. Insert it between "studio" and "social" to match the user journey flow (Create → Edit → Publish):

Change:
```typescript
const PILLARS = [
  { id: "studio", label: "AI Studio", href: "/studio" },
  { id: "social", label: "Social Hub", href: "/social" },
  { id: "analytics", label: "Analytics", href: "/analytics" },
] as const;
```

To:
```typescript
const PILLARS = [
  { id: "studio", label: "AI Studio", href: "/studio" },
  { id: "editor", label: "Video Editor", href: "/editor/projects" },
  { id: "social", label: "Social Hub", href: "/social" },
  { id: "analytics", label: "Analytics", href: "/analytics" },
] as const;
```

- [ ] **Step 2: Update SocialAppSidebar.tsx PILLAR_ITEMS**

Add the editor entry to `PILLAR_ITEMS`. You'll need to import a video icon — use `VideoIcon` from lucide-react.

Add to imports:
```typescript
import {
  CalendarIcon,
  PenSquareIcon,
  FileTextIcon,
  ActivityIcon,
  PlusIcon,
  BananaIcon,
  PaletteIcon,
  BarChart3Icon,
  VideoIcon,
} from "lucide-react"
```

Change:
```typescript
const PILLAR_ITEMS = [
  { href: "/studio", label: "AI Studio", icon: PaletteIcon },
  { href: "/social", label: "Social Hub", icon: ActivityIcon },
  { href: "/analytics", label: "Analytics", icon: BarChart3Icon },
]
```

To:
```typescript
const PILLAR_ITEMS = [
  { href: "/studio", label: "AI Studio", icon: PaletteIcon },
  { href: "/editor/projects", label: "Video Editor", icon: VideoIcon },
  { href: "/social", label: "Social Hub", icon: ActivityIcon },
  { href: "/analytics", label: "Analytics", icon: BarChart3Icon },
]
```

- [ ] **Step 3: Verify the navigation renders correctly**

Run: `cd /Users/neoak/projects/node-banana && pnpm dev`
Navigate to `/social/calendar`. Open the pillar switcher dropdown — "Video Editor" should appear between "AI Studio" and "Social Hub".

- [ ] **Step 4: Commit**

```bash
cd /Users/neoak/projects/node-banana
git add src/components/social/PillarSwitcher.tsx src/components/social/SocialAppSidebar.tsx
git commit -m "feat: add Video Editor to pillar navigation"
```

---

### Task 6: Configure OpenCut Fork — Install Microfrontends Package

**Context:** The OpenCut fork needs `@vercel/microfrontends` and its `next.config.ts` wrapped so that asset prefixes work correctly when served as a child microfrontend.

**Files:**
- Modify: `/Users/neoak/projects/OpenCut/apps/web/package.json`
- Modify: `/Users/neoak/projects/OpenCut/apps/web/next.config.ts`

- [ ] **Step 1: Install the microfrontends package**

Run: `cd /Users/neoak/projects/OpenCut/apps/web && bun add @vercel/microfrontends`

- [ ] **Step 2: Update next.config.ts**

Current file wraps with `withContentCollections(withBotId(nextConfig))`. Add `withMicrofrontends` as the outermost wrapper. Also remove `output: "standalone"` — Vercel microfrontends manages the output mode.

```typescript
import type { NextConfig } from "next";
import { withBotId } from "botid/next/config";
import { withContentCollections } from "@content-collections/next";
import { withMicrofrontends } from "@vercel/microfrontends/next/config";

const nextConfig: NextConfig = {
	turbopack: {
		rules: {
			"*.glsl": {
				loaders: [require.resolve("raw-loader")],
				as: "*.js",
			},
		},
	},
	compiler: {
		removeConsole: process.env.NODE_ENV === "production",
	},
	reactStrictMode: true,
	productionBrowserSourceMaps: true,
	images: {
		remotePatterns: [
			{
				protocol: "https",
				hostname: "plus.unsplash.com",
			},
			{
				protocol: "https",
				hostname: "images.unsplash.com",
			},
			{
				protocol: "https",
				hostname: "images.marblecms.com",
			},
			{
				protocol: "https",
				hostname: "lh3.googleusercontent.com",
			},
			{
				protocol: "https",
				hostname: "avatars.githubusercontent.com",
			},
			{
				protocol: "https",
				hostname: "api.iconify.design",
			},
			{
				protocol: "https",
				hostname: "api.simplesvg.com",
			},
			{
				protocol: "https",
				hostname: "api.unisvg.com",
			},
		],
	},
};

export default withMicrofrontends(withContentCollections(withBotId(nextConfig)));
```

- [ ] **Step 3: Verify build**

Run: `cd /Users/neoak/projects/OpenCut && bun run build:web`
Expected: Build succeeds.

- [ ] **Step 4: Commit**

```bash
cd /Users/neoak/projects/OpenCut
git add apps/web/next.config.ts apps/web/package.json apps/web/bun.lock
git commit -m "chore: add @vercel/microfrontends and wrap next config"
```

---

### Task 7: Configure OpenCut Fork — Auth Alignment

**Context:** OpenCut's Better Auth must point to the same database and use the same secret as Node Banana. The current setup requires Upstash Redis and many env vars not needed for editor-only mode. We need to simplify.

**Files:**
- Modify: `/Users/neoak/projects/OpenCut/apps/web/src/lib/auth/server.ts`
- Modify: `/Users/neoak/projects/OpenCut/apps/web/src/lib/auth/client.ts`
- Modify: `/Users/neoak/projects/OpenCut/packages/env/src/web.ts`

- [ ] **Step 1: Upgrade Better Auth**

Run: `cd /Users/neoak/projects/OpenCut/apps/web && bun add better-auth@1.5.5`

- [ ] **Step 2: Simplify env validation**

The current `packages/env/src/web.ts` requires many env vars (Upstash, Marble, Freesound, R2, Modal) that the editor doesn't need. Make non-editor vars optional:

```typescript
import { z } from "zod";

const webEnvSchema = z.object({
	// Node
	NODE_ENV: z.enum(["development", "production", "test"]),
	ANALYZE: z.string().optional(),
	NEXT_RUNTIME: z.enum(["nodejs", "edge"]).optional(),

	// Public
	NEXT_PUBLIC_SITE_URL: z.url().default("http://localhost:3000"),
	NEXT_PUBLIC_MARBLE_API_URL: z.url().optional(),

	// Server — Required for auth
	DATABASE_URL: z
		.string()
		.startsWith("postgres://")
		.or(z.string().startsWith("postgresql://")),
	BETTER_AUTH_SECRET: z.string(),

	// Server — Optional (not needed for editor-only mode)
	UPSTASH_REDIS_REST_URL: z.url().optional(),
	UPSTASH_REDIS_REST_TOKEN: z.string().optional(),
	MARBLE_WORKSPACE_KEY: z.string().optional(),
	FREESOUND_CLIENT_ID: z.string().optional(),
	FREESOUND_API_KEY: z.string().optional(),
	CLOUDFLARE_ACCOUNT_ID: z.string().optional(),
	R2_ACCESS_KEY_ID: z.string().optional(),
	R2_SECRET_ACCESS_KEY: z.string().optional(),
	R2_BUCKET_NAME: z.string().optional(),
	MODAL_TRANSCRIPTION_URL: z.url().optional(),
});

export type WebEnv = z.infer<typeof webEnvSchema>;

export const webEnv = webEnvSchema.parse(process.env);
```

- [ ] **Step 3: Simplify auth server config**

Remove Upstash rate limiting (not needed — Node Banana handles rate limiting). Make it conditional if Redis vars are present:

```typescript
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { db } from "@/lib/db";
import { webEnv } from "@opencut/env/web";

export const auth = betterAuth({
	database: drizzleAdapter(db, {
		provider: "pg",
		usePlural: true,
	}),
	secret: webEnv.BETTER_AUTH_SECRET,
	user: {
		deleteUser: {
			enabled: true,
		},
	},
	emailAndPassword: {
		enabled: true,
	},
	baseURL: webEnv.NEXT_PUBLIC_SITE_URL,
	appName: "OpenCut",
	trustedOrigins: [webEnv.NEXT_PUBLIC_SITE_URL],
});

export type Auth = typeof auth;
```

- [ ] **Step 4: Update auth client**

```typescript
import { createAuthClient } from "better-auth/react";
import { webEnv } from "@opencut/env/web";

export const { signIn, signUp, useSession } = createAuthClient({
	baseURL: webEnv.NEXT_PUBLIC_SITE_URL,
});
```

This file is actually unchanged in structure — the key is that `NEXT_PUBLIC_SITE_URL` will point to the shared domain (e.g., `https://banana.app`) in production env vars on Vercel. No code change needed here, just env var alignment at deploy time.

- [ ] **Step 5: Verify the auth module imports cleanly**

Run: `cd /Users/neoak/projects/OpenCut && bun run build:web`
Expected: Build succeeds. The auth module should compile without requiring Upstash env vars.

- [ ] **Step 6: Commit**

```bash
cd /Users/neoak/projects/OpenCut
git add apps/web/src/lib/auth/server.ts packages/env/src/web.ts apps/web/package.json apps/web/bun.lock
git commit -m "feat: align Better Auth with Node Banana — upgrade to 1.5.5, remove Upstash requirement"
```

---

### Task 8: Configure OpenCut Fork — Auth Gate on Editor Routes

**Context:** OpenCut currently has NO auth checks on `/editor/*`. Anyone can access the editor. We need a layout-level gate that redirects unauthenticated users to `/sign-in` (which lives in Node Banana).

**Files:**
- Create: `/Users/neoak/projects/OpenCut/apps/web/src/app/editor/layout.tsx`

- [ ] **Step 1: Create the editor layout with auth gate**

```typescript
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

This is a server component. It checks the session cookie (shared via same domain) and redirects to `/sign-in` if not authenticated. Since `/sign-in` is not under `/editor/*`, Vercel routes it to Node Banana (the default app) which owns the sign-in page.

- [ ] **Step 2: Verify the layout wraps editor routes**

Run: `cd /Users/neoak/projects/OpenCut && bun run build:web`
Expected: Build succeeds. The layout should be picked up by Next.js for all `/editor/*` routes.

- [ ] **Step 3: Commit**

```bash
cd /Users/neoak/projects/OpenCut
git add apps/web/src/app/editor/layout.tsx
git commit -m "feat: add auth gate to editor routes — redirect to /sign-in if unauthenticated"
```

---

### Task 9: Configure OpenCut Fork — Route Restructuring

**Context:** OpenCut's `/projects` page needs to move to `/editor/projects` so it falls under the `/editor/*` microfrontend routing. Marketing/landing pages need to be removed. The editor header's "Exit project" link needs to point to the new path.

**Files:**
- Move: `apps/web/src/app/projects/` → `apps/web/src/app/editor/projects/`
- Remove: Marketing routes (landing page, blog, changelog, etc.)
- Modify: `apps/web/src/components/editor/editor-header.tsx` (line 63, line 95)

- [ ] **Step 1: Move projects page under /editor**

```bash
cd /Users/neoak/projects/OpenCut/apps/web
mkdir -p src/app/editor/projects
# Move the projects page.tsx into the editor directory
mv src/app/projects/page.tsx src/app/editor/projects/page.tsx
# If there are other files in projects/ (layout, loading, etc.), move them too:
# mv src/app/projects/layout.tsx src/app/editor/projects/layout.tsx
# Remove the now-empty directory
rm -rf src/app/projects
```

- [ ] **Step 2: Update editor header navigation**

In `apps/web/src/components/editor/editor-header.tsx`, the `handleExit` function navigates to `/projects`. Update it to `/editor/projects`:

Change line 63:
```typescript
			router.push("/projects");
```
To:
```typescript
			router.push("/editor/projects");
```

Change line 95:
```typescript
				router.push("/projects");
```
To:
```typescript
				router.push("/editor/projects");
```

- [ ] **Step 3: Remove marketing routes**

Delete routes that are not needed in the editor microfrontend. Check which exist first:

```bash
cd /Users/neoak/projects/OpenCut/apps/web/src/app
# Remove marketing/content pages if they exist
rm -rf blog brand changelog contributors privacy roadmap sponsors terms
# Remove the landing page (keep the root layout)
# Check if page.tsx at root is a landing page:
# If so, replace it with a redirect to /editor/projects
```

If `apps/web/src/app/page.tsx` is a landing page, replace it with:

```typescript
import { redirect } from "next/navigation";

export default function Home() {
  redirect("/editor/projects");
}
```

- [ ] **Step 4: Verify routes work**

Run: `cd /Users/neoak/projects/OpenCut && bun dev:web`
Expected: Visiting `http://localhost:3000` redirects to `/editor/projects`. The projects page loads. Opening a project shows the editor. "Exit project" navigates back to `/editor/projects`.

- [ ] **Step 5: Commit**

```bash
cd /Users/neoak/projects/OpenCut
git add -A
git commit -m "feat: restructure routes — move /projects to /editor/projects, remove marketing pages"
```

---

### Task 10: Configure OpenCut Fork — Pillar Navigation Header

**Context:** Once inside the editor, users need a way to navigate back to Studio or Social. Add a pillar navigation component to the editor header.

**Files:**
- Create: `/Users/neoak/projects/OpenCut/apps/web/src/components/editor/pillar-nav.tsx`
- Modify: `/Users/neoak/projects/OpenCut/apps/web/src/components/editor/editor-header.tsx`

- [ ] **Step 1: Create the pillar navigation component**

```typescript
// apps/web/src/components/editor/pillar-nav.tsx
"use client";

import { useState, useRef, useEffect } from "react";
import { ChevronDown } from "lucide-react";

const PILLAR_ITEMS = [
  { id: "studio", label: "AI Studio", href: "/studio" },
  { id: "editor", label: "Video Editor", href: "/editor/projects" },
  { id: "social", label: "Social Hub", href: "/social" },
] as const;

export function PillarNav() {
  const [isOpen, setIsOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    }
    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
      return () =>
        document.removeEventListener("mousedown", handleClickOutside);
    }
  }, [isOpen]);

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-1.5 rounded-md border border-border bg-background px-2.5 py-1 text-xs font-medium transition-colors hover:bg-accent"
      >
        <span>Video Editor</span>
        <ChevronDown
          className={`size-3 text-muted-foreground transition-transform ${isOpen ? "rotate-180" : ""}`}
        />
      </button>

      {isOpen && (
        <div className="absolute left-0 top-full z-50 mt-1 w-40 rounded-md border border-border bg-popover py-1 shadow-md">
          {PILLAR_ITEMS.map((item) => (
            <a
              key={item.id}
              href={item.href}
              onClick={() => setIsOpen(false)}
              className={`flex items-center px-3 py-1.5 text-xs transition-colors ${
                item.id === "editor"
                  ? "bg-accent text-accent-foreground"
                  : "text-muted-foreground hover:bg-accent/50 hover:text-foreground"
              }`}
            >
              {item.label}
              {item.id === "editor" && (
                <span className="ml-auto text-[9px] text-muted-foreground">
                  current
                </span>
              )}
            </a>
          ))}
        </div>
      )}
    </div>
  );
}
```

Uses plain `<a href>` tags (not Next.js `<Link>`) because cross-microfrontend navigation requires a full page load.

- [ ] **Step 2: Add PillarNav to the editor header**

In `apps/web/src/components/editor/editor-header.tsx`, add the pillar nav next to the project dropdown:

Change the header's left section (around line 31):
```typescript
			<div className="flex items-center gap-1">
				<ProjectDropdown />
				<EditableProjectName />
			</div>
```

To:
```typescript
			<div className="flex items-center gap-1">
				<ProjectDropdown />
				<PillarNav />
				<EditableProjectName />
			</div>
```

Add the import at the top of the file:
```typescript
import { PillarNav } from "./pillar-nav";
```

- [ ] **Step 3: Verify the pillar nav renders**

Run: `cd /Users/neoak/projects/OpenCut && bun dev:web`
Expected: Open a project in the editor. The header shows a "Video Editor" dropdown between the project menu and the project name. Clicking it shows Studio, Video Editor (current), Social Hub.

- [ ] **Step 4: Commit**

```bash
cd /Users/neoak/projects/OpenCut
git add apps/web/src/components/editor/pillar-nav.tsx apps/web/src/components/editor/editor-header.tsx
git commit -m "feat: add pillar navigation to editor header for cross-app navigation"
```

---

### Task 11: Configure OpenCut Fork — Clean Up Unused Dependencies

**Context:** Remove dependencies that are only needed for OpenCut's standalone features (CMS, analytics, rate limiting) to reduce the bundle and simplify deployment.

**Files:**
- Modify: `/Users/neoak/projects/OpenCut/apps/web/package.json`

- [ ] **Step 1: Remove unused dependencies**

```bash
cd /Users/neoak/projects/OpenCut/apps/web
bun remove @upstash/redis @upstash/ratelimit @vercel/analytics content-collections @content-collections/next
```

Note: Only remove packages that are not imported by the editor code. Before removing, verify no editor component imports them:

```bash
cd /Users/neoak/projects/OpenCut
grep -r "@upstash" apps/web/src/ --include="*.ts" --include="*.tsx" | grep -v "auth/server"
grep -r "@vercel/analytics" apps/web/src/ --include="*.ts" --include="*.tsx"
grep -r "content-collections" apps/web/src/ --include="*.ts" --include="*.tsx"
```

If any editor code imports these, keep the dependency. Only remove if the only usage was in files we've already modified (like auth/server.ts) or deleted (marketing pages).

- [ ] **Step 2: Update next.config.ts if content-collections was removed**

If `@content-collections/next` was removed, update `next.config.ts` to remove its wrapper:

```typescript
import type { NextConfig } from "next";
import { withBotId } from "botid/next/config";
import { withMicrofrontends } from "@vercel/microfrontends/next/config";

const nextConfig: NextConfig = {
	// ... same as Task 6 Step 2 but without withContentCollections
};

export default withMicrofrontends(withBotId(nextConfig));
```

- [ ] **Step 3: Verify build**

Run: `cd /Users/neoak/projects/OpenCut && bun run build:web`
Expected: Build succeeds with no missing module errors.

- [ ] **Step 4: Commit**

```bash
cd /Users/neoak/projects/OpenCut
git add apps/web/package.json apps/web/bun.lock apps/web/next.config.ts
git commit -m "chore: remove unused dependencies for editor-only deployment"
```

---

### Task 12: Verify Local Development Setup

**Context:** Test the full microfrontend setup locally using the dev proxy. Both apps should run simultaneously with the proxy routing between them.

**Files:** No new files — this is a verification task.

- [ ] **Step 1: Ensure both apps have access to microfrontends.json**

The OpenCut fork needs to know about the microfrontends config. Set the env var pointing to Node Banana's config:

```bash
cd /Users/neoak/projects/OpenCut
echo "VC_MICROFRONTENDS_CONFIG=/Users/neoak/projects/node-banana/microfrontends.json" >> apps/web/.env.local
```

- [ ] **Step 2: Start Node Banana dev server**

```bash
cd /Users/neoak/projects/node-banana
pnpm dev
# Note the port (likely 3000 based on server.js)
```

- [ ] **Step 3: Start OpenCut dev server**

```bash
cd /Users/neoak/projects/OpenCut/apps/web
bun dev --port 3001
# Or use: bun dev --port $(microfrontends port) if the CLI is available
```

- [ ] **Step 4: Start the microfrontends proxy**

```bash
cd /Users/neoak/projects/node-banana
pnpm proxy
# Proxy should start on port 3024 (configured in microfrontends.json)
```

- [ ] **Step 5: Test routing through the proxy**

Visit `http://localhost:3024` — should show Node Banana's landing page.
Visit `http://localhost:3024/studio` — should show AI Studio.
Visit `http://localhost:3024/social` — should show Social Hub.
Visit `http://localhost:3024/editor/projects` — should show OpenCut's projects page.

If auth is configured, sign in first at `http://localhost:3024/sign-in`, then verify `/editor/projects` works.

- [ ] **Step 6: Test cross-pillar navigation**

From Social Hub, open the pillar switcher → click "Video Editor" → should navigate to `/editor/projects`.
From the editor, open the pillar nav → click "AI Studio" → should navigate to `/studio`.

- [ ] **Step 7: Document any issues found**

If the proxy doesn't route correctly, check:
1. `microfrontends.json` application names match Vercel project names
2. Both dev servers are running on expected ports
3. `VC_MICROFRONTENDS_CONFIG` env var is set correctly in OpenCut

---

### Task 13: Vercel Deployment Configuration

**Context:** Set up both projects on Vercel and create the microfrontends group. This is a manual step done in the Vercel dashboard/CLI.

**Files:** No code files — Vercel configuration.

- [ ] **Step 1: Create Vercel projects (if not already done)**

```bash
# Link Node Banana
cd /Users/neoak/projects/node-banana
vercel link

# Link OpenCut fork
cd /Users/neoak/projects/OpenCut
vercel link
```

- [ ] **Step 2: Create microfrontends group**

```bash
vercel microfrontends create-group
```

Follow prompts to:
- Name the group (e.g., "banana-app")
- Add both projects (`node-banana` and `opencut-editor`)
- Set `node-banana` as the default application

- [ ] **Step 3: Set shared environment variables**

In the Vercel dashboard, add these env vars to BOTH projects:

```
DATABASE_URL=<shared postgres connection string>
BETTER_AUTH_SECRET=<same secret for both>
BETTER_AUTH_URL=https://<your-domain>
NEXT_PUBLIC_APP_URL=https://<your-domain>
NEXT_PUBLIC_SITE_URL=https://<your-domain>
```

For the OpenCut project specifically, set:
```
NODE_ENV=production
```

- [ ] **Step 4: Configure OpenCut project settings**

In Vercel dashboard for the OpenCut project:
- Set **Root Directory** to `apps/web`
- Set **Build Command** to `bun run build`
- Set **Framework** to Next.js

- [ ] **Step 5: Deploy both projects**

Deploy Node Banana first (it has the `microfrontends.json`), then OpenCut. On subsequent deploys, they can deploy independently.

- [ ] **Step 6: Verify production routing**

Visit your production domain:
- `https://<domain>/` — Node Banana landing
- `https://<domain>/editor/projects` — OpenCut projects page
- `https://<domain>/studio` — AI Studio

---

## Summary

| Task | Repo | What |
|------|------|------|
| 1 | OpenCut | Fork setup + integration branch |
| 2 | Node Banana | Create `microfrontends.json` |
| 3 | Node Banana | Install package + wrap `next.config.ts` |
| 4 | Node Banana | Middleware + fallback page |
| 5 | Node Banana | Update pillar navigation |
| 6 | OpenCut | Install package + wrap `next.config.ts` |
| 7 | OpenCut | Auth alignment (upgrade, simplify env, remove Upstash) |
| 8 | OpenCut | Auth gate on `/editor/*` |
| 9 | OpenCut | Route restructuring (move projects, remove marketing) |
| 10 | OpenCut | Pillar navigation header |
| 11 | OpenCut | Clean up unused dependencies |
| 12 | Both | Local dev verification |
| 13 | Both | Vercel deployment setup |

Tasks 2-5 (Node Banana) and Tasks 6-11 (OpenCut) can be worked in parallel since they're in separate repos.
