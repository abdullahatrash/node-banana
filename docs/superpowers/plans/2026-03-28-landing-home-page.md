# Landing Home Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the root page redirect-to-studio with a proper landing page featuring a header (logo, app switcher, auth, language switcher), hero section with illustration, and footer.

**Architecture:** Extract the pillar app navigation into a shared `AppSwitcher` component, build lightweight `HomeHeader` and `HomeFooter` components, then rewrite the root `page.tsx` to render the landing page with a hero section. The `HomeHeader` is a client component using `authClient.useSession()` for reactive auth state.

**Tech Stack:** Next.js App Router, React, Tailwind CSS, lucide-react icons, existing `DropdownMenu` UI components, `authClient` from Better Auth.

---

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `src/components/AppSwitcher.tsx` | Create | Shared app navigation dropdown (pillar items + command center) |
| `src/components/HomeHeader.tsx` | Create | Landing page header: logo, app switcher, language switcher, auth |
| `src/components/HomeFooter.tsx` | Create | Landing page footer: credits and discord link |
| `src/app/page.tsx` | Rewrite | Server component rendering landing page layout with hero |
| `src/components/social/SocialAppSidebar.tsx` | Modify | Replace inline pillar dropdown with shared `AppSwitcher` |

---

### Task 1: Create AppSwitcher Component

**Files:**
- Create: `src/components/AppSwitcher.tsx`

- [ ] **Step 1: Create the AppSwitcher component**

Create `src/components/AppSwitcher.tsx`:

```tsx
"use client"

import { usePathname } from "next/navigation"
import {
  PaletteIcon,
  VideoIcon,
  ActivityIcon,
  BarChart3Icon,
} from "lucide-react"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

const PILLAR_ITEMS = [
  { href: "/studio", label: "AI Studio", icon: PaletteIcon },
  { href: "/editor/projects", label: "Video Editor", icon: VideoIcon },
  { href: "/social", label: "Social Hub", icon: ActivityIcon },
  { href: "/analytics", label: "Analytics", icon: BarChart3Icon },
]

interface AppSwitcherProps {
  children: React.ReactNode
  align?: "start" | "center" | "end"
}

export function AppSwitcher({ children, align = "start" }: AppSwitcherProps) {
  const pathname = usePathname()

  const currentHref = PILLAR_ITEMS.find(
    (item) => pathname === item.href || pathname?.startsWith(item.href + "/")
  )?.href

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        {children}
      </DropdownMenuTrigger>
      <DropdownMenuContent align={align} className="w-48">
        {PILLAR_ITEMS.map((item) => (
          <DropdownMenuItem
            key={item.href}
            onClick={() => (window.location.href = item.href)}
          >
            <item.icon className="size-4" />
            <span>{item.label}</span>
            {item.href === currentHref && (
              <span className="ms-auto text-[10px] text-muted-foreground">
                current
              </span>
            )}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onClick={() => (window.location.href = "/dashboard")}
        >
          <BarChart3Icon className="size-4" />
          <span>Command Center</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
```

- [ ] **Step 2: Verify it compiles**

Run: `pnpm build 2>&1 | head -30`
Expected: No errors related to `AppSwitcher.tsx`.

- [ ] **Step 3: Commit**

```bash
git add src/components/AppSwitcher.tsx
git commit -m "feat: create shared AppSwitcher component

Extract pillar app navigation dropdown into a reusable component."
```

---

### Task 2: Update SocialAppSidebar to Use AppSwitcher

**Files:**
- Modify: `src/components/social/SocialAppSidebar.tsx`

- [ ] **Step 1: Replace inline dropdown with AppSwitcher**

In `src/components/social/SocialAppSidebar.tsx`:

1. Remove the `PILLAR_ITEMS` constant (lines 52-57).
2. Remove unused icon imports: `PaletteIcon`, `VideoIcon`, `BarChart3Icon`.
3. Remove unused imports: `DropdownMenuSeparator`.
4. Add import: `import { AppSwitcher } from "@/components/AppSwitcher"`.
5. Replace the entire `<DropdownMenu>` block in `SidebarHeader` (lines 76-97) with:

```tsx
<AppSwitcher>
  <button className="flex w-full items-center gap-2 rounded-md p-1.5 text-start text-sm font-semibold hover:bg-sidebar-accent">
    <BananaIcon className="size-5" />
    <span className="text-base font-semibold">Social Hub</span>
  </button>
</AppSwitcher>
```

The `DropdownMenu`, `DropdownMenuContent`, `DropdownMenuItem`, `DropdownMenuTrigger` imports are still needed by other parts of the file — check before removing. If only used in the pillar dropdown, remove them too; otherwise keep.

- [ ] **Step 2: Verify it compiles**

Run: `pnpm build 2>&1 | head -30`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/social/SocialAppSidebar.tsx
git commit -m "refactor: use shared AppSwitcher in SocialAppSidebar

Replace inline pillar items dropdown with the shared AppSwitcher component."
```

---

### Task 3: Create HomeHeader Component

**Files:**
- Create: `src/components/HomeHeader.tsx`

- [ ] **Step 1: Create the HomeHeader component**

Create `src/components/HomeHeader.tsx`:

```tsx
"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import { useState } from "react"
import { authClient } from "@/lib/auth/client"
import { setActiveWorkspaceId } from "@/lib/studio/client"
import { LanguageSwitcher } from "@/components/LanguageSwitcher"
import { AppSwitcher } from "@/components/AppSwitcher"

export function HomeHeader() {
  const router = useRouter()
  const { data: session } = authClient.useSession()
  const [isSigningOut, setIsSigningOut] = useState(false)

  const handleSignOut = async () => {
    setIsSigningOut(true)
    try {
      const result = await authClient.signOut()
      const signOutError =
        result &&
        typeof result === "object" &&
        "error" in result
          ? (result as { error?: unknown }).error
          : null
      if (signOutError) {
        throw signOutError
      }
      setActiveWorkspaceId(null)
      router.refresh()
    } catch (error) {
      console.error("Failed to sign out:", error)
    } finally {
      setIsSigningOut(false)
    }
  }

  const sessionLabel =
    (typeof session?.user?.name === "string" && session.user.name.trim()) ||
    (typeof session?.user?.email === "string" && session.user.email.trim()) ||
    "Signed in"

  return (
    <header className="h-11 bg-neutral-900 border-b border-neutral-800 flex items-center justify-between px-4 shrink-0 sticky top-0 z-50">
      <div className="flex items-center gap-2">
        <AppSwitcher>
          <button className="flex items-center gap-2 hover:opacity-80 transition-opacity">
            <img src="/banana_icon.png" alt="Banana" className="w-6 h-6" />
            <h1 className="text-2xl font-semibold text-neutral-100 tracking-tight">
              Node Banana
            </h1>
          </button>
        </AppSwitcher>
      </div>

      <div className="flex items-center gap-3 text-xs">
        <LanguageSwitcher className="text-neutral-400 hover:text-neutral-200 hover:bg-neutral-800" />
        {session?.user ? (
          <>
            <span
              className="text-neutral-300 truncate max-w-[220px]"
              title={sessionLabel}
            >
              {sessionLabel}
            </span>
            <button
              onClick={() => void handleSignOut()}
              disabled={isSigningOut}
              className="text-neutral-400 hover:text-neutral-200 transition-colors disabled:opacity-60"
              title="Sign out"
            >
              {isSigningOut ? "Signing out..." : "Sign out"}
            </button>
          </>
        ) : (
          <>
            <Link
              href="/sign-in"
              className="text-neutral-400 hover:text-neutral-200 transition-colors"
            >
              Sign in
            </Link>
            <Link
              href="/sign-up"
              className="text-neutral-400 hover:text-neutral-200 transition-colors"
            >
              Sign up
            </Link>
          </>
        )}
      </div>
    </header>
  )
}
```

- [ ] **Step 2: Verify it compiles**

Run: `pnpm build 2>&1 | head -30`
Expected: No errors related to `HomeHeader.tsx`.

- [ ] **Step 3: Commit**

```bash
git add src/components/HomeHeader.tsx
git commit -m "feat: create HomeHeader component for landing page

Lightweight header with logo, app switcher, language switcher, and auth controls."
```

---

### Task 4: Create HomeFooter Component

**Files:**
- Create: `src/components/HomeFooter.tsx`

- [ ] **Step 1: Create the HomeFooter component**

Create `src/components/HomeFooter.tsx`:

```tsx
export function HomeFooter() {
  return (
    <footer className="border-t border-neutral-800 bg-neutral-900 px-4 py-4">
      <div className="flex items-center justify-center gap-3 text-xs">
        <a
          href="https://x.com/abodiatrash"
          target="_blank"
          rel="noopener noreferrer"
          className="text-neutral-400 hover:text-neutral-200 transition-colors"
        >
          Made by abodi
        </a>
        <span className="text-neutral-500">·</span>
        <a
          href="https://discord.com/invite/89Nr6EKkTf"
          target="_blank"
          rel="noopener noreferrer"
          className="text-neutral-400 hover:text-neutral-200 transition-colors flex items-center gap-1"
        >
          <svg
            className="w-4 h-4"
            fill="currentColor"
            viewBox="0 0 24 24"
            xmlns="http://www.w3.org/2000/svg"
          >
            <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515a.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0a12.64 12.64 0 0 0-.617-1.25a.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057a19.9 19.9 0 0 0 5.993 3.03a.078.078 0 0 0 .084-.028a14.09 14.09 0 0 0 1.226-1.994a.076.076 0 0 0-.041-.106a13.107 13.107 0 0 1-1.872-.892a.077.077 0 0 1-.008-.128a10.2 10.2 0 0 0 .372-.292a.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127a12.299 12.299 0 0 1-1.873.892a.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028a19.839 19.839 0 0 0 6.002-3.03a.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419c0-1.333.956-2.419 2.157-2.419c1.21 0 2.176 1.096 2.157 2.42c0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419c0-1.333.955-2.419 2.157-2.419c1.21 0 2.176 1.096 2.157 2.42c0 1.333-.946 2.418-2.157 2.418z" />
          </svg>
          Discord
        </a>
      </div>
    </footer>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/HomeFooter.tsx
git commit -m "feat: create HomeFooter component for landing page

Simple footer with credits and Discord link."
```

---

### Task 5: Rewrite Root Page

**Files:**
- Modify: `src/app/page.tsx`

- [ ] **Step 1: Rewrite page.tsx to render the landing page**

Replace the entire contents of `src/app/page.tsx` with:

```tsx
import Link from "next/link"
import { headers } from "next/headers"
import { getServerAuthSession } from "@/lib/auth/session"
import { HomeHeader } from "@/components/HomeHeader"
import { HomeFooter } from "@/components/HomeFooter"

export default async function HomePage() {
  const session = await getServerAuthSession(await headers())

  return (
    <div className="min-h-screen flex flex-col bg-neutral-950 text-neutral-100">
      <HomeHeader />

      <main className="flex-1 flex items-center justify-center px-6 md:px-12">
        <div className="flex flex-col md:flex-row items-center gap-12 max-w-5xl w-full">
          {/* Left: text + CTAs */}
          <div className="flex-1 flex flex-col items-start gap-6">
            <h2 className="text-5xl md:text-6xl font-bold tracking-tight">
              Node Banana
            </h2>
            <p className="text-lg text-neutral-400 max-w-md">
              Node-based AI image generation workflow editor
            </p>
            <div className="flex items-center gap-3">
              <Link
                href="/studio"
                className="inline-flex items-center justify-center rounded-md bg-neutral-100 text-neutral-900 px-5 py-2.5 text-sm font-medium hover:bg-neutral-200 transition-colors"
              >
                Open Studio
              </Link>
              {!session?.user && (
                <Link
                  href="/sign-in"
                  className="inline-flex items-center justify-center rounded-md border border-neutral-700 text-neutral-100 px-5 py-2.5 text-sm font-medium hover:border-neutral-500 transition-colors"
                >
                  Sign in
                </Link>
              )}
            </div>
          </div>

          {/* Right: hero image */}
          <div className="flex-1 flex justify-center">
            <img
              src="/hero-horse.png"
              alt="Node Banana"
              className="w-full max-w-[450px] h-auto object-contain"
              draggable={false}
            />
          </div>
        </div>
      </main>

      <HomeFooter />
    </div>
  )
}
```

- [ ] **Step 2: Verify it compiles and the page loads**

Run: `pnpm build 2>&1 | head -40`
Expected: No errors. The root page renders the landing layout.

- [ ] **Step 3: Commit**

```bash
git add src/app/page.tsx
git commit -m "feat: rewrite root page as landing page with hero section

Remove redirect-to-studio. Show header, hero with illustration, and footer."
```

---

### Task 6: Manual Verification

- [ ] **Step 1: Start dev server and verify**

Run: `pnpm dev`

Check the following in the browser:

1. `http://localhost:3000` — shows the landing page with header, hero section (text left, horse image right), and footer. No redirect to `/studio`.
2. Header has logo + "Node Banana" text that opens the app switcher dropdown on click.
3. App switcher shows: AI Studio, Video Editor, Social Hub, Analytics, separator, Command Center.
4. Language switcher is present and toggles between English/Arabic.
5. If signed out: "Sign in" and "Sign up" links in header + secondary "Sign in" CTA in hero.
6. If signed in: user name/email + "Sign out" button in header, no secondary CTA.
7. `http://localhost:3000/social` — sidebar app switcher still works correctly (uses shared `AppSwitcher`).
8. Responsive: on narrow viewport, hero stacks vertically (text on top, image below).
9. RTL: switch to Arabic via language switcher — hero layout flips (text on right, image on left), header items reorder correctly, dropdown aligns properly.

- [ ] **Step 2: Final commit if any tweaks were needed**

Only if adjustments were made during manual verification.
