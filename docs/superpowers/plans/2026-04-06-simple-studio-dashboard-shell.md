# Simple Studio Dashboard Shell Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a new top-level `/simple-studio` pillar with a social-style sidebar shell (`SidebarProvider` + `SidebarInset`), five routes (Images / Videos / Copy / Library / Prompt Library), inline form-first pages with a right-side info panel, a dedicated Library gallery, and a Prompt Library tabbed view — all reusing the existing `useSimpleStudioStore` and `/api/studio/prompts` backend without modification. The old `/studio/simple` route stays untouched during PR 1 and is deleted in a separate PR 2.

**Architecture:** A new route tree under `src/app/simple-studio/` wraps its children in `SimpleStudioLayout` (which mirrors `SocialLayout`). Each form route renders its per-mode form component inline inside a shared `FormPageLayout` (form body left, `FormInfoPanel` right). `LibraryGallery` replaces the old ResultsGallery on the `/library` route. `PromptLibraryTabs` shows templates (public prompts) and saved prompts via the existing store actions. A tiny `useSimpleStudioShellStore` holds UI-only state (SavePromptDialog open/close, library filter, active tab). A `urlToMode.ts` module maps friendly URL segments (`images` / `videos` / `copy`) to the existing mode enum (`photo` / `video` / `copy`). AppSwitcher's pillar list is updated to split "AI Studio" into "Simple Studio" and "Advanced Workflow".

**Tech Stack:** Next.js 16 (App Router), TypeScript, Zustand, shadcn/ui (Sidebar / Sheet / Dialog / Tabs / Separator / Button), Tailwind CSS, Vitest + Testing Library, pnpm 10.

**Spec:** `docs/superpowers/specs/2026-04-06-simple-studio-dashboard-shell-design.md`

---

## Prerequisites

Before starting Task 1, the executing engineer should:

1. Have the spec file open as a reference.
2. Run `pnpm install` to ensure dependencies are in sync.
3. Confirm the current branch is `develop` and create a feature branch:
   ```bash
   git checkout develop
   git pull
   git checkout -b feature/simple-studio-dashboard-shell
   ```
4. Verify baseline tests pass: `pnpm test:run` (record any pre-existing failures unrelated to this work so they aren't attributed to the plan).
5. Read `src/store/simpleStudioStore.ts` lines 19-106 to understand the shape of `SimpleStudioMode`, `Generation`, `SavedPrompt`, and the store interface. Every form component interacts with this store — the engineer must know the field names.
6. Read `src/components/social/SocialLayout.tsx`, `SocialAppSidebar.tsx`, and `SocialSiteHeader.tsx` in full. The new shell mirrors this structure exactly; these are the canonical examples.

---

## File Structure

**Created files:**

```
src/app/simple-studio/
  layout.tsx                            server: auth gate + <SimpleStudioLayout>
  page.tsx                              redirect → /simple-studio/images
  images/page.tsx                       renders <ImageForm />
  videos/page.tsx                       renders <VideoForm />
  copy/page.tsx                         renders <CopyForm />
  library/page.tsx                      renders <LibraryGallery />
  prompt-library/page.tsx               renders <PromptLibraryTabs />

src/components/simple-studio-shell/
  SimpleStudioLayout.tsx                client: SidebarProvider + Inset + mode sync
  SimpleStudioAppSidebar.tsx            client: nav sidebar with AppSwitcher + NavUser
  SimpleStudioSiteHeader.tsx            client: page title + contextual action
  LibraryGallery.tsx                    client: generations grid w/ mode filter
  PromptLibraryTabs.tsx                 client: templates + saved tabs
  SavePromptDialog.tsx                  client: dialog shared by form pages + prompt library
  urlToMode.ts                          URL segment ↔ SimpleStudioMode mapping
  forms/
    FormPageLayout.tsx                  shared 2-column layout
    FormInfoPanel.tsx                   aspect ratio, cost, example, tips
    ImageForm.tsx                       photo-mode form
    VideoForm.tsx                       video-mode form
    CopyForm.tsx                        copy-mode form
  __tests__/
    urlToMode.test.ts
    SimpleStudioAppSidebar.test.tsx
    SimpleStudioSiteHeader.test.tsx
    LibraryGallery.test.tsx
    PromptLibraryTabs.test.tsx
    SavePromptDialog.test.tsx
  forms/__tests__/
    FormPageLayout.test.tsx
    ImageForm.test.tsx
    VideoForm.test.tsx
    CopyForm.test.tsx

src/store/
  simpleStudioShellStore.ts             Zustand UI-only store

src/store/__tests__/
  simpleStudioShellStore.test.ts
```

**Modified files:**

- `src/components/AppSwitcher.tsx` — update `PILLAR_ITEMS` to split Simple Studio / Advanced Workflow.

**Explicitly untouched:**

- `src/app/studio/simple/*` (old page).
- `src/components/simple-studio/*` (old sidebar + gallery).
- `src/store/simpleStudioStore.ts` (old store — read-only dependency).
- `src/lib/db/schema.ts` (reuses existing `savedPrompts` table).
- `src/app/api/studio/prompts/**` (reuses existing routes).

---

## Task 1: URL-to-mode mapping module

**Files:**
- Create: `src/components/simple-studio-shell/urlToMode.ts`
- Test: `src/components/simple-studio-shell/__tests__/urlToMode.test.ts`

This is a pure function module with no dependencies — perfect first task to validate the directory structure works.

- [ ] **Step 1: Write the failing test**

Create `src/components/simple-studio-shell/__tests__/urlToMode.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  URL_SEGMENT_TO_MODE,
  MODE_TO_URL_SEGMENT,
  modeFromPathname,
} from "../urlToMode";

describe("urlToMode", () => {
  describe("URL_SEGMENT_TO_MODE", () => {
    it("maps images → photo", () => {
      expect(URL_SEGMENT_TO_MODE.images).toBe("photo");
    });
    it("maps videos → video", () => {
      expect(URL_SEGMENT_TO_MODE.videos).toBe("video");
    });
    it("maps copy → copy", () => {
      expect(URL_SEGMENT_TO_MODE.copy).toBe("copy");
    });
  });

  describe("MODE_TO_URL_SEGMENT", () => {
    it("is the inverse of URL_SEGMENT_TO_MODE", () => {
      expect(MODE_TO_URL_SEGMENT.photo).toBe("images");
      expect(MODE_TO_URL_SEGMENT.video).toBe("videos");
      expect(MODE_TO_URL_SEGMENT.copy).toBe("copy");
    });
  });

  describe("modeFromPathname", () => {
    it("returns photo for /simple-studio/images", () => {
      expect(modeFromPathname("/simple-studio/images")).toBe("photo");
    });
    it("returns video for /simple-studio/videos", () => {
      expect(modeFromPathname("/simple-studio/videos")).toBe("video");
    });
    it("returns copy for /simple-studio/copy", () => {
      expect(modeFromPathname("/simple-studio/copy")).toBe("copy");
    });
    it("handles trailing segments", () => {
      expect(modeFromPathname("/simple-studio/images/")).toBe("photo");
    });
    it("returns null for /simple-studio/library", () => {
      expect(modeFromPathname("/simple-studio/library")).toBeNull();
    });
    it("returns null for /simple-studio/prompt-library", () => {
      expect(modeFromPathname("/simple-studio/prompt-library")).toBeNull();
    });
    it("returns null for /simple-studio", () => {
      expect(modeFromPathname("/simple-studio")).toBeNull();
    });
    it("returns null for unrelated paths", () => {
      expect(modeFromPathname("/studio/simple")).toBeNull();
      expect(modeFromPathname("/social/calendar")).toBeNull();
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test:run src/components/simple-studio-shell/__tests__/urlToMode.test.ts`
Expected: FAIL with "Cannot find module '../urlToMode'".

- [ ] **Step 3: Write the minimal implementation**

Create `src/components/simple-studio-shell/urlToMode.ts`:

```ts
import type { SimpleStudioMode } from "@/store/simpleStudioStore";

export const URL_SEGMENT_TO_MODE: Record<"images" | "videos" | "copy", SimpleStudioMode> = {
  images: "photo",
  videos: "video",
  copy: "copy",
};

export const MODE_TO_URL_SEGMENT: Record<SimpleStudioMode, "images" | "videos" | "copy"> = {
  photo: "images",
  video: "videos",
  copy: "copy",
};

const PATH_REGEX = /^\/simple-studio\/(images|videos|copy)(?:\/|$)/;

export function modeFromPathname(pathname: string): SimpleStudioMode | null {
  const match = pathname.match(PATH_REGEX);
  if (!match) return null;
  const segment = match[1] as "images" | "videos" | "copy";
  return URL_SEGMENT_TO_MODE[segment] ?? null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test:run src/components/simple-studio-shell/__tests__/urlToMode.test.ts`
Expected: PASS, all 11 tests green.

- [ ] **Step 5: Commit**

```bash
git add src/components/simple-studio-shell/urlToMode.ts src/components/simple-studio-shell/__tests__/urlToMode.test.ts
git commit -m "feat(simple-studio): add URL segment to mode mapping module"
```

---

## Task 2: Shell store (UI-only state)

**Files:**
- Create: `src/store/simpleStudioShellStore.ts`
- Test: `src/store/__tests__/simpleStudioShellStore.test.ts`

A small Zustand store for dialog, library filter, and prompt library tab state. No API calls.

- [ ] **Step 1: Write the failing test**

Create `src/store/__tests__/simpleStudioShellStore.test.ts`:

```ts
import { beforeEach, describe, expect, it } from "vitest";
import { useSimpleStudioShellStore } from "../simpleStudioShellStore";

describe("useSimpleStudioShellStore", () => {
  beforeEach(() => {
    // Reset store to initial state between tests
    useSimpleStudioShellStore.setState({
      savePromptDialogOpen: false,
      libraryModeFilter: "all",
      promptLibraryTab: "templates",
    });
  });

  describe("save prompt dialog", () => {
    it("initializes closed", () => {
      expect(useSimpleStudioShellStore.getState().savePromptDialogOpen).toBe(false);
    });

    it("openSavePromptDialog sets open to true", () => {
      useSimpleStudioShellStore.getState().openSavePromptDialog();
      expect(useSimpleStudioShellStore.getState().savePromptDialogOpen).toBe(true);
    });

    it("closeSavePromptDialog sets open to false", () => {
      useSimpleStudioShellStore.setState({ savePromptDialogOpen: true });
      useSimpleStudioShellStore.getState().closeSavePromptDialog();
      expect(useSimpleStudioShellStore.getState().savePromptDialogOpen).toBe(false);
    });
  });

  describe("library mode filter", () => {
    it("defaults to all", () => {
      expect(useSimpleStudioShellStore.getState().libraryModeFilter).toBe("all");
    });

    it("setLibraryModeFilter updates the filter", () => {
      useSimpleStudioShellStore.getState().setLibraryModeFilter("photo");
      expect(useSimpleStudioShellStore.getState().libraryModeFilter).toBe("photo");

      useSimpleStudioShellStore.getState().setLibraryModeFilter("video");
      expect(useSimpleStudioShellStore.getState().libraryModeFilter).toBe("video");

      useSimpleStudioShellStore.getState().setLibraryModeFilter("copy");
      expect(useSimpleStudioShellStore.getState().libraryModeFilter).toBe("copy");

      useSimpleStudioShellStore.getState().setLibraryModeFilter("all");
      expect(useSimpleStudioShellStore.getState().libraryModeFilter).toBe("all");
    });
  });

  describe("prompt library tab", () => {
    it("defaults to templates", () => {
      expect(useSimpleStudioShellStore.getState().promptLibraryTab).toBe("templates");
    });

    it("setPromptLibraryTab switches between templates and saved", () => {
      useSimpleStudioShellStore.getState().setPromptLibraryTab("saved");
      expect(useSimpleStudioShellStore.getState().promptLibraryTab).toBe("saved");

      useSimpleStudioShellStore.getState().setPromptLibraryTab("templates");
      expect(useSimpleStudioShellStore.getState().promptLibraryTab).toBe("templates");
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test:run src/store/__tests__/simpleStudioShellStore.test.ts`
Expected: FAIL with "Cannot find module '../simpleStudioShellStore'".

- [ ] **Step 3: Write the minimal implementation**

Create `src/store/simpleStudioShellStore.ts`:

```ts
import { create } from "zustand";

export type LibraryModeFilter = "all" | "photo" | "video" | "copy";
export type PromptLibraryTab = "templates" | "saved";

interface SimpleStudioShellState {
  // Save prompt dialog
  savePromptDialogOpen: boolean;
  openSavePromptDialog: () => void;
  closeSavePromptDialog: () => void;

  // Library filter
  libraryModeFilter: LibraryModeFilter;
  setLibraryModeFilter: (mode: LibraryModeFilter) => void;

  // Prompt library active tab
  promptLibraryTab: PromptLibraryTab;
  setPromptLibraryTab: (tab: PromptLibraryTab) => void;
}

export const useSimpleStudioShellStore = create<SimpleStudioShellState>((set) => ({
  savePromptDialogOpen: false,
  openSavePromptDialog: () => set({ savePromptDialogOpen: true }),
  closeSavePromptDialog: () => set({ savePromptDialogOpen: false }),

  libraryModeFilter: "all",
  setLibraryModeFilter: (mode) => set({ libraryModeFilter: mode }),

  promptLibraryTab: "templates",
  setPromptLibraryTab: (tab) => set({ promptLibraryTab: tab }),
}));
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test:run src/store/__tests__/simpleStudioShellStore.test.ts`
Expected: PASS, all 8 tests green.

- [ ] **Step 5: Commit**

```bash
git add src/store/simpleStudioShellStore.ts src/store/__tests__/simpleStudioShellStore.test.ts
git commit -m "feat(simple-studio): add shell UI-only store"
```

---

## Task 3: SimpleStudioAppSidebar component

**Files:**
- Create: `src/components/simple-studio-shell/SimpleStudioAppSidebar.tsx`
- Test: `src/components/simple-studio-shell/__tests__/SimpleStudioAppSidebar.test.tsx`

Mirrors `SocialAppSidebar.tsx` structure. Two nav groups (Create / Browse), AppSwitcher header, NavUser footer.

- [ ] **Step 1: Write the failing test**

Create `src/components/simple-studio-shell/__tests__/SimpleStudioAppSidebar.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SimpleStudioAppSidebar } from "../SimpleStudioAppSidebar";
import { SidebarProvider } from "@/components/ui/sidebar";

// Mock next/navigation to control pathname
vi.mock("next/navigation", () => ({
  usePathname: () => "/simple-studio/images",
}));

// Mock authClient.useSession to provide a stable user
vi.mock("@/lib/auth/client", () => ({
  authClient: {
    useSession: () => ({
      data: { user: { name: "Test User", email: "test@example.com", image: "" } },
    }),
  },
}));

function renderSidebar() {
  return render(
    <SidebarProvider>
      <SimpleStudioAppSidebar />
    </SidebarProvider>,
  );
}

describe("SimpleStudioAppSidebar", () => {
  it("renders all five nav items", () => {
    renderSidebar();
    expect(screen.getByText("Images")).toBeInTheDocument();
    expect(screen.getByText("Videos")).toBeInTheDocument();
    expect(screen.getByText("Copy")).toBeInTheDocument();
    expect(screen.getByText("Library")).toBeInTheDocument();
    expect(screen.getByText("Prompt Library")).toBeInTheDocument();
  });

  it("renders Create and Browse group labels", () => {
    renderSidebar();
    expect(screen.getByText("Create")).toBeInTheDocument();
    expect(screen.getByText("Browse")).toBeInTheDocument();
  });

  it("renders the AppSwitcher trigger with Simple Studio label", () => {
    renderSidebar();
    expect(screen.getByText("Simple Studio")).toBeInTheDocument();
  });

  it("renders the user's name in the footer", () => {
    renderSidebar();
    expect(screen.getByText("Test User")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test:run src/components/simple-studio-shell/__tests__/SimpleStudioAppSidebar.test.tsx`
Expected: FAIL with "Cannot find module '../SimpleStudioAppSidebar'".

- [ ] **Step 3: Write the minimal implementation**

Create `src/components/simple-studio-shell/SimpleStudioAppSidebar.tsx`:

```tsx
"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  ImageIcon,
  VideoIcon,
  FileTextIcon,
  GalleryThumbnailsIcon,
  BookmarkIcon,
  PaletteIcon,
} from "lucide-react";
import { NavUser } from "@/components/nav-user";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarSeparator,
} from "@/components/ui/sidebar";
import { AppSwitcher } from "@/components/AppSwitcher";
import { authClient } from "@/lib/auth/client";

const CREATE_ITEMS = [
  { href: "/simple-studio/images", label: "Images", icon: ImageIcon },
  { href: "/simple-studio/videos", label: "Videos", icon: VideoIcon },
  { href: "/simple-studio/copy", label: "Copy", icon: FileTextIcon },
];

const BROWSE_ITEMS = [
  { href: "/simple-studio/library", label: "Library", icon: GalleryThumbnailsIcon },
  { href: "/simple-studio/prompt-library", label: "Prompt Library", icon: BookmarkIcon },
];

export function SimpleStudioAppSidebar({ ...props }: React.ComponentProps<typeof Sidebar>) {
  const pathname = usePathname();
  const session = authClient.useSession();

  const user = {
    name: session.data?.user?.name || "User",
    email: session.data?.user?.email || "",
    avatar: session.data?.user?.image || "",
  };

  const isActive = (href: string) =>
    pathname === href || pathname?.startsWith(href + "/");

  return (
    <Sidebar collapsible="offcanvas" {...props}>
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <AppSwitcher>
              <div className="flex w-full items-center gap-2 rounded-md p-1.5 text-start text-sm font-semibold hover:bg-sidebar-accent cursor-pointer">
                <PaletteIcon className="size-5" />
                <span className="text-base font-semibold">Simple Studio</span>
              </div>
            </AppSwitcher>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Create</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {CREATE_ITEMS.map((item) => (
                <SidebarMenuItem key={item.href}>
                  <SidebarMenuButton
                    isActive={isActive(item.href)}
                    render={<Link href={item.href} />}
                  >
                    <item.icon />
                    <span>{item.label}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarSeparator />

        <SidebarGroup>
          <SidebarGroupLabel>Browse</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {BROWSE_ITEMS.map((item) => (
                <SidebarMenuItem key={item.href}>
                  <SidebarMenuButton
                    isActive={isActive(item.href)}
                    render={<Link href={item.href} />}
                  >
                    <item.icon />
                    <span>{item.label}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter>
        <NavUser user={user} />
      </SidebarFooter>
    </Sidebar>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test:run src/components/simple-studio-shell/__tests__/SimpleStudioAppSidebar.test.tsx`
Expected: PASS, all 4 tests green.

Note: if the test fails with a `<Link>` rendering error, ensure `next/link` is being mocked appropriately or that the `Sidebar` primitive supports `render={<Link />}` in the current version (it does in the existing `SocialAppSidebar.tsx` — match that pattern exactly).

- [ ] **Step 5: Commit**

```bash
git add src/components/simple-studio-shell/SimpleStudioAppSidebar.tsx src/components/simple-studio-shell/__tests__/SimpleStudioAppSidebar.test.tsx
git commit -m "feat(simple-studio): add app sidebar with Create/Browse groups"
```

---

## Task 4: SimpleStudioSiteHeader component

**Files:**
- Create: `src/components/simple-studio-shell/SimpleStudioSiteHeader.tsx`
- Test: `src/components/simple-studio-shell/__tests__/SimpleStudioSiteHeader.test.tsx`

Site header with contextual right-side action that varies by route.

- [ ] **Step 1: Write the failing test**

Create `src/components/simple-studio-shell/__tests__/SimpleStudioSiteHeader.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import userEvent from "@testing-library/user-event";
import { SimpleStudioSiteHeader } from "../SimpleStudioSiteHeader";
import { SidebarProvider } from "@/components/ui/sidebar";
import { useSimpleStudioShellStore } from "@/store/simpleStudioShellStore";

const pathnameMock = vi.fn();
vi.mock("next/navigation", () => ({
  usePathname: () => pathnameMock(),
}));

function renderHeader() {
  return render(
    <SidebarProvider>
      <SimpleStudioSiteHeader />
    </SidebarProvider>,
  );
}

describe("SimpleStudioSiteHeader", () => {
  beforeEach(() => {
    useSimpleStudioShellStore.setState({
      savePromptDialogOpen: false,
      libraryModeFilter: "all",
      promptLibraryTab: "templates",
    });
  });

  it("shows 'Images' title on /simple-studio/images", () => {
    pathnameMock.mockReturnValue("/simple-studio/images");
    renderHeader();
    expect(screen.getByRole("heading", { name: "Images" })).toBeInTheDocument();
  });

  it("shows 'Library' title on /simple-studio/library", () => {
    pathnameMock.mockReturnValue("/simple-studio/library");
    renderHeader();
    expect(screen.getByRole("heading", { name: "Library" })).toBeInTheDocument();
  });

  it("shows 'Prompt Library' title on /simple-studio/prompt-library", () => {
    pathnameMock.mockReturnValue("/simple-studio/prompt-library");
    renderHeader();
    expect(screen.getByRole("heading", { name: "Prompt Library" })).toBeInTheDocument();
  });

  it("shows a Save prompt button on a form route", () => {
    pathnameMock.mockReturnValue("/simple-studio/images");
    renderHeader();
    expect(screen.getByRole("button", { name: /save prompt/i })).toBeInTheDocument();
  });

  it("Save prompt button opens the dialog via the store", async () => {
    pathnameMock.mockReturnValue("/simple-studio/images");
    renderHeader();
    await userEvent.click(screen.getByRole("button", { name: /save prompt/i }));
    expect(useSimpleStudioShellStore.getState().savePromptDialogOpen).toBe(true);
  });

  it("shows a New Saved Prompt button on the prompt-library route", () => {
    pathnameMock.mockReturnValue("/simple-studio/prompt-library");
    renderHeader();
    expect(screen.getByRole("button", { name: /new saved prompt/i })).toBeInTheDocument();
  });

  it("shows filter pills on the library route", () => {
    pathnameMock.mockReturnValue("/simple-studio/library");
    renderHeader();
    expect(screen.getByRole("button", { name: /^all$/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^photo$/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^video$/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^copy$/i })).toBeInTheDocument();
  });

  it("clicking a filter pill updates the store", async () => {
    pathnameMock.mockReturnValue("/simple-studio/library");
    renderHeader();
    await userEvent.click(screen.getByRole("button", { name: /^photo$/i }));
    expect(useSimpleStudioShellStore.getState().libraryModeFilter).toBe("photo");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test:run src/components/simple-studio-shell/__tests__/SimpleStudioSiteHeader.test.tsx`
Expected: FAIL with "Cannot find module '../SimpleStudioSiteHeader'".

- [ ] **Step 3: Write the minimal implementation**

Create `src/components/simple-studio-shell/SimpleStudioSiteHeader.tsx`:

```tsx
"use client";

import { usePathname } from "next/navigation";
import { PlusIcon, BookmarkIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { SidebarTrigger } from "@/components/ui/sidebar";
import {
  useSimpleStudioShellStore,
  type LibraryModeFilter,
} from "@/store/simpleStudioShellStore";

const PAGE_TITLES: Record<string, string> = {
  "/simple-studio/images": "Images",
  "/simple-studio/videos": "Videos",
  "/simple-studio/copy": "Copy",
  "/simple-studio/library": "Library",
  "/simple-studio/prompt-library": "Prompt Library",
};

const FILTER_VALUES: { value: LibraryModeFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "photo", label: "Photo" },
  { value: "video", label: "Video" },
  { value: "copy", label: "Copy" },
];

function resolveTitle(pathname: string | null): string {
  if (!pathname) return "Simple Studio";
  const exact = PAGE_TITLES[pathname];
  if (exact) return exact;
  const prefixMatch = Object.entries(PAGE_TITLES).find(([path]) =>
    pathname.startsWith(path + "/"),
  );
  return prefixMatch ? prefixMatch[1] : "Simple Studio";
}

function isFormRoute(pathname: string | null): boolean {
  if (!pathname) return false;
  return (
    pathname === "/simple-studio/images" ||
    pathname === "/simple-studio/videos" ||
    pathname === "/simple-studio/copy" ||
    pathname.startsWith("/simple-studio/images/") ||
    pathname.startsWith("/simple-studio/videos/") ||
    pathname.startsWith("/simple-studio/copy/")
  );
}

export function SimpleStudioSiteHeader() {
  const pathname = usePathname();
  const title = resolveTitle(pathname);
  const openSavePromptDialog = useSimpleStudioShellStore(
    (s) => s.openSavePromptDialog,
  );
  const libraryModeFilter = useSimpleStudioShellStore((s) => s.libraryModeFilter);
  const setLibraryModeFilter = useSimpleStudioShellStore(
    (s) => s.setLibraryModeFilter,
  );

  const isLibrary = pathname === "/simple-studio/library";
  const isPromptLibrary = pathname === "/simple-studio/prompt-library";
  const isForm = isFormRoute(pathname);

  return (
    <header className="flex h-(--header-height) shrink-0 items-center gap-2 border-b transition-[width,height] ease-linear group-has-data-[collapsible=icon]/sidebar-wrapper:h-(--header-height)">
      <div className="flex w-full items-center gap-1 px-4 lg:gap-2 lg:px-6">
        <SidebarTrigger className="-ms-1" />
        <Separator
          orientation="vertical"
          className="mx-2 h-4 data-vertical:self-auto"
        />
        <h1 className="text-base font-medium">{title}</h1>

        <div className="ms-auto flex items-center gap-2">
          {isLibrary &&
            FILTER_VALUES.map((f) => (
              <Button
                key={f.value}
                size="sm"
                variant={libraryModeFilter === f.value ? "default" : "ghost"}
                onClick={() => setLibraryModeFilter(f.value)}
              >
                {f.label}
              </Button>
            ))}

          {isForm && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => openSavePromptDialog()}
            >
              <BookmarkIcon className="size-4" />
              Save prompt
            </Button>
          )}

          {isPromptLibrary && (
            <Button size="sm" onClick={() => openSavePromptDialog()}>
              <PlusIcon className="size-4" />
              New Saved Prompt
            </Button>
          )}
        </div>
      </div>
    </header>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test:run src/components/simple-studio-shell/__tests__/SimpleStudioSiteHeader.test.tsx`
Expected: PASS, all 8 tests green.

- [ ] **Step 5: Commit**

```bash
git add src/components/simple-studio-shell/SimpleStudioSiteHeader.tsx src/components/simple-studio-shell/__tests__/SimpleStudioSiteHeader.test.tsx
git commit -m "feat(simple-studio): add site header with contextual route actions"
```

---

## Task 5: SimpleStudioLayout component

**Files:**
- Create: `src/components/simple-studio-shell/SimpleStudioLayout.tsx`

No dedicated test — this is a thin composition. Its children (the sidebar, header, and forms) are tested independently. If the layout breaks, route-level integration tests in Task 14 will catch it.

- [ ] **Step 1: Write the implementation**

Create `src/components/simple-studio-shell/SimpleStudioLayout.tsx`:

```tsx
"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { useSimpleStudioStore } from "@/store/simpleStudioStore";
import { SimpleStudioAppSidebar } from "./SimpleStudioAppSidebar";
import { SimpleStudioSiteHeader } from "./SimpleStudioSiteHeader";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { modeFromPathname } from "./urlToMode";

interface SimpleStudioLayoutProps {
  children: React.ReactNode;
}

export function SimpleStudioLayout({ children }: SimpleStudioLayoutProps) {
  const pathname = usePathname();
  const setMode = useSimpleStudioStore((s) => s.setMode);
  const loadRecentResults = useSimpleStudioStore((s) => s.loadRecentResults);
  const initialized = useRef(false);

  // Sync store mode with URL on every pathname change
  useEffect(() => {
    const mode = modeFromPathname(pathname ?? "");
    if (mode) {
      setMode(mode);
    }
  }, [pathname, setMode]);

  // Load recent results once on first mount
  if (!initialized.current) {
    initialized.current = true;
    loadRecentResults();
  }

  return (
    <SidebarProvider
      style={
        {
          "--sidebar-width": "calc(var(--spacing) * 64)",
          "--header-height": "calc(var(--spacing) * 12)",
        } as React.CSSProperties
      }
    >
      <SimpleStudioAppSidebar variant="inset" />
      <SidebarInset>
        <SimpleStudioSiteHeader />
        <div className="flex flex-1 flex-col">{children}</div>
      </SidebarInset>
    </SidebarProvider>
  );
}
```

- [ ] **Step 2: Sanity-check by typecheck**

Run: `pnpm lint`
Expected: no TypeScript errors in the new file.

- [ ] **Step 3: Commit**

```bash
git add src/components/simple-studio-shell/SimpleStudioLayout.tsx
git commit -m "feat(simple-studio): add layout wrapper with pathname-to-mode sync"
```

---

## Task 6: Route layout.tsx, page.tsx, and five empty child pages

**Files:**
- Create: `src/app/simple-studio/layout.tsx`
- Create: `src/app/simple-studio/page.tsx`
- Create: `src/app/simple-studio/images/page.tsx`
- Create: `src/app/simple-studio/videos/page.tsx`
- Create: `src/app/simple-studio/copy/page.tsx`
- Create: `src/app/simple-studio/library/page.tsx`
- Create: `src/app/simple-studio/prompt-library/page.tsx`

All five child pages are placeholder "Coming Soon" stubs for now — they'll be filled in by later tasks. This task proves the routing and shell work end-to-end.

- [ ] **Step 1: Create the auth-gated server layout**

Create `src/app/simple-studio/layout.tsx`:

```tsx
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getServerAuthSession } from "@/lib/auth/session";
import { SimpleStudioLayout } from "@/components/simple-studio-shell/SimpleStudioLayout";

export default async function SimpleStudioRootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const session = await getServerAuthSession(await headers());

  if (!session?.user) {
    redirect("/sign-in?next=%2Fsimple-studio%2Fimages");
  }

  return <SimpleStudioLayout>{children}</SimpleStudioLayout>;
}
```

- [ ] **Step 2: Create the root redirect**

Create `src/app/simple-studio/page.tsx`:

```tsx
import { redirect } from "next/navigation";

export default function SimpleStudioRootPage() {
  redirect("/simple-studio/images");
}
```

- [ ] **Step 3: Create five placeholder child pages**

Create `src/app/simple-studio/images/page.tsx`:

```tsx
export default function ImagesPage() {
  return (
    <div className="p-6 text-sm text-muted-foreground">Images page — coming soon.</div>
  );
}
```

Create `src/app/simple-studio/videos/page.tsx`:

```tsx
export default function VideosPage() {
  return (
    <div className="p-6 text-sm text-muted-foreground">Videos page — coming soon.</div>
  );
}
```

Create `src/app/simple-studio/copy/page.tsx`:

```tsx
export default function CopyPage() {
  return (
    <div className="p-6 text-sm text-muted-foreground">Copy page — coming soon.</div>
  );
}
```

Create `src/app/simple-studio/library/page.tsx`:

```tsx
export default function LibraryPage() {
  return (
    <div className="p-6 text-sm text-muted-foreground">Library page — coming soon.</div>
  );
}
```

Create `src/app/simple-studio/prompt-library/page.tsx`:

```tsx
export default function PromptLibraryPage() {
  return (
    <div className="p-6 text-sm text-muted-foreground">
      Prompt Library page — coming soon.
    </div>
  );
}
```

- [ ] **Step 4: Manual smoke test**

Run: `pnpm dev` (background or separate terminal), then visit `http://localhost:3000/simple-studio` in a browser while signed in.

Expected:
- Redirects to `/simple-studio/images`.
- Shell renders with sidebar, header, "Images" title.
- Clicking Videos / Copy / Library / Prompt Library in the sidebar navigates and updates the header title.
- Clicking Videos on the sidebar while on Images sets the mode to `video` in the store (verifiable via React DevTools if the executing engineer wants to confirm).
- Unauthenticated visit to `/simple-studio` redirects to `/sign-in?next=%2Fsimple-studio%2Fimages`.

Stop `pnpm dev` after verifying.

- [ ] **Step 5: Commit**

```bash
git add src/app/simple-studio/
git commit -m "feat(simple-studio): add route shell with five placeholder pages"
```

---

## Task 7: AppSwitcher pillar update

**Files:**
- Modify: `src/components/AppSwitcher.tsx`

Split the "AI Studio" entry into "Simple Studio" and "Advanced Workflow".

- [ ] **Step 1: Read current AppSwitcher state**

Run: `cat src/components/AppSwitcher.tsx` (or use the Read tool) to confirm the current `PILLAR_ITEMS` matches what the spec described. If it has diverged, update this task's patch accordingly.

Expected shape:
```tsx
const PILLAR_ITEMS = [
  { href: "/studio", label: "AI Studio", icon: PaletteIcon },
  { href: "/editor/projects", label: "Video Editor", icon: VideoIcon },
  { href: "/social", label: "Social Hub", icon: ActivityIcon },
  { href: "/analytics", label: "Analytics", icon: BarChart3Icon },
]
```

- [ ] **Step 2: Update the import list**

In `src/components/AppSwitcher.tsx`, update the lucide-react import to add `WorkflowIcon`:

```tsx
import {
  PaletteIcon,
  VideoIcon,
  ActivityIcon,
  BarChart3Icon,
  WorkflowIcon,
} from "lucide-react";
```

- [ ] **Step 3: Update PILLAR_ITEMS**

Replace the existing `PILLAR_ITEMS` array with:

```tsx
const PILLAR_ITEMS = [
  { href: "/simple-studio/images", label: "Simple Studio", icon: PaletteIcon },
  { href: "/studio", label: "Advanced Workflow", icon: WorkflowIcon },
  { href: "/editor/projects", label: "Video Editor", icon: VideoIcon },
  { href: "/social", label: "Social Hub", icon: ActivityIcon },
  { href: "/analytics", label: "Analytics", icon: BarChart3Icon },
]
```

- [ ] **Step 4: Verify lint and typecheck pass**

Run: `pnpm lint`
Expected: no errors.

- [ ] **Step 5: Manual smoke test**

Run: `pnpm dev`, open the app, click the AppSwitcher trigger in any pillar.

Expected:
- Dropdown shows Simple Studio, Advanced Workflow, Video Editor, Social Hub, Analytics, Command Center.
- Clicking "Simple Studio" navigates to `/simple-studio/images`.
- Clicking "Advanced Workflow" navigates to `/studio` (the advanced node editor).
- When on any `/simple-studio/*` route, "Simple Studio" shows the "current" label in the dropdown.

- [ ] **Step 6: Commit**

```bash
git add src/components/AppSwitcher.tsx
git commit -m "feat(app-switcher): split AI Studio into Simple + Advanced Workflow pillars"
```

---

## Task 8: FormPageLayout and FormInfoPanel shared components

**Files:**
- Create: `src/components/simple-studio-shell/forms/FormPageLayout.tsx`
- Create: `src/components/simple-studio-shell/forms/FormInfoPanel.tsx`
- Test: `src/components/simple-studio-shell/forms/__tests__/FormPageLayout.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `src/components/simple-studio-shell/forms/__tests__/FormPageLayout.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { FormPageLayout } from "../FormPageLayout";

describe("FormPageLayout", () => {
  it("renders the form body slot", () => {
    render(
      <FormPageLayout infoPanel={<div>Info</div>}>
        <div>Form body</div>
      </FormPageLayout>,
    );
    expect(screen.getByText("Form body")).toBeInTheDocument();
  });

  it("renders the info panel slot", () => {
    render(
      <FormPageLayout infoPanel={<div>Info content</div>}>
        <div>Form body</div>
      </FormPageLayout>,
    );
    expect(screen.getByText("Info content")).toBeInTheDocument();
  });

  it("renders both slots in the same document", () => {
    render(
      <FormPageLayout infoPanel={<div data-testid="panel">Panel</div>}>
        <div data-testid="body">Body</div>
      </FormPageLayout>,
    );
    expect(screen.getByTestId("body")).toBeInTheDocument();
    expect(screen.getByTestId("panel")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test:run src/components/simple-studio-shell/forms/__tests__/FormPageLayout.test.tsx`
Expected: FAIL with "Cannot find module '../FormPageLayout'".

- [ ] **Step 3: Write the minimal implementation of FormPageLayout**

Create `src/components/simple-studio-shell/forms/FormPageLayout.tsx`:

```tsx
"use client";

import type { ReactNode } from "react";

interface FormPageLayoutProps {
  children: ReactNode;
  infoPanel: ReactNode;
}

export function FormPageLayout({ children, infoPanel }: FormPageLayoutProps) {
  return (
    <div className="flex flex-1 flex-col-reverse gap-6 overflow-y-auto p-6 lg:flex-row">
      <div className="flex-1">
        <div className="mx-auto w-full max-w-2xl">{children}</div>
      </div>
      <aside className="lg:w-80 lg:shrink-0">{infoPanel}</aside>
    </div>
  );
}
```

Note: `flex-col-reverse` on mobile puts the info panel above the form body (matching the mobile behavior in the spec).

- [ ] **Step 4: Write the minimal FormInfoPanel**

Create `src/components/simple-studio-shell/forms/FormInfoPanel.tsx`:

```tsx
"use client";

import type { ReactNode } from "react";

interface FormInfoPanelProps {
  aspectRatios?: { value: string; label: string }[];
  batchPresets?: number[];
  outputExample?: ReactNode;
  tips?: ReactNode;
  currentAspectRatio?: string;
  onAspectRatioChange?: (value: string) => void;
  currentBatchCount?: number;
  onBatchCountChange?: (value: number) => void;
  estimatedCost?: ReactNode;
}

export function FormInfoPanel({
  aspectRatios,
  batchPresets,
  outputExample,
  tips,
  currentAspectRatio,
  onAspectRatioChange,
  currentBatchCount,
  onBatchCountChange,
  estimatedCost,
}: FormInfoPanelProps) {
  return (
    <div className="space-y-4 rounded-lg border bg-card p-4 text-sm">
      {aspectRatios && aspectRatios.length > 0 && (
        <section>
          <div className="mb-2 text-xs font-medium text-muted-foreground">
            Aspect ratio
          </div>
          <div className="flex flex-wrap gap-2">
            {aspectRatios.map((r) => (
              <button
                key={r.value}
                type="button"
                className={`rounded-md border px-3 py-1 text-xs ${
                  currentAspectRatio === r.value
                    ? "border-primary bg-primary/10"
                    : "border-border hover:bg-muted"
                }`}
                onClick={() => onAspectRatioChange?.(r.value)}
              >
                {r.label}
              </button>
            ))}
          </div>
        </section>
      )}

      {batchPresets && batchPresets.length > 0 && (
        <section>
          <div className="mb-2 text-xs font-medium text-muted-foreground">
            Batch count
          </div>
          <div className="flex flex-wrap gap-2">
            {batchPresets.map((n) => (
              <button
                key={n}
                type="button"
                className={`rounded-md border px-3 py-1 text-xs ${
                  currentBatchCount === n
                    ? "border-primary bg-primary/10"
                    : "border-border hover:bg-muted"
                }`}
                onClick={() => onBatchCountChange?.(n)}
              >
                {n}
              </button>
            ))}
          </div>
        </section>
      )}

      {estimatedCost && (
        <section>
          <div className="mb-1 text-xs font-medium text-muted-foreground">
            Estimated cost
          </div>
          <div>{estimatedCost}</div>
        </section>
      )}

      {outputExample && (
        <section>
          <div className="mb-2 text-xs font-medium text-muted-foreground">
            Output example
          </div>
          {outputExample}
        </section>
      )}

      {tips && (
        <section className="text-xs text-muted-foreground">{tips}</section>
      )}
    </div>
  );
}
```

Note: this is intentionally a minimal styled shell. Visual polish (exact shadcn card styling, icons, layout tuning) can be tweaked during manual QA — the test only asserts structure.

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm test:run src/components/simple-studio-shell/forms/__tests__/FormPageLayout.test.tsx`
Expected: PASS, all 3 tests green.

- [ ] **Step 6: Commit**

```bash
git add src/components/simple-studio-shell/forms/FormPageLayout.tsx src/components/simple-studio-shell/forms/FormInfoPanel.tsx src/components/simple-studio-shell/forms/__tests__/FormPageLayout.test.tsx
git commit -m "feat(simple-studio): add shared FormPageLayout and FormInfoPanel"
```

---

## Task 9: ImageForm component

**Files:**
- Create: `src/components/simple-studio-shell/forms/ImageForm.tsx`
- Test: `src/components/simple-studio-shell/forms/__tests__/ImageForm.test.tsx`

Renders an inline image-generation form wired to `useSimpleStudioStore`. For v1 the form is intentionally minimal — prompt textarea, model picker placeholder (reuses existing model list if possible; otherwise a read-only display of the currently selected model name), and Generate button. Aspect ratio and batch count come from `FormInfoPanel`.

- [ ] **Step 1: Write the failing test**

Create `src/components/simple-studio-shell/forms/__tests__/ImageForm.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, beforeEach, vi } from "vitest";
import { ImageForm } from "../ImageForm";
import { useSimpleStudioStore } from "@/store/simpleStudioStore";

describe("ImageForm", () => {
  beforeEach(() => {
    useSimpleStudioStore.setState({
      mode: "photo",
      prompt: "",
      aspectRatio: "1:1",
      batchCount: 4,
      isGenerating: false,
    });
  });

  it("renders a prompt textarea", () => {
    render(<ImageForm />);
    expect(screen.getByLabelText(/prompt/i)).toBeInTheDocument();
  });

  it("renders a Generate button", () => {
    render(<ImageForm />);
    expect(screen.getByRole("button", { name: /generate/i })).toBeInTheDocument();
  });

  it("typing in the prompt textarea updates the store", async () => {
    render(<ImageForm />);
    const textarea = screen.getByLabelText(/prompt/i);
    await userEvent.type(textarea, "A cat");
    expect(useSimpleStudioStore.getState().prompt).toBe("A cat");
  });

  it("clicking Generate calls the store's generate action", async () => {
    const generateSpy = vi.fn().mockResolvedValue(undefined);
    useSimpleStudioStore.setState({
      prompt: "A cat",
      generate: generateSpy,
    });
    render(<ImageForm />);
    await userEvent.click(screen.getByRole("button", { name: /generate/i }));
    expect(generateSpy).toHaveBeenCalled();
  });

  it("Generate button is disabled when prompt is empty", () => {
    useSimpleStudioStore.setState({ prompt: "" });
    render(<ImageForm />);
    expect(screen.getByRole("button", { name: /generate/i })).toBeDisabled();
  });

  it("Generate button is disabled while generating", () => {
    useSimpleStudioStore.setState({ prompt: "A cat", isGenerating: true });
    render(<ImageForm />);
    expect(screen.getByRole("button", { name: /generate/i })).toBeDisabled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test:run src/components/simple-studio-shell/forms/__tests__/ImageForm.test.tsx`
Expected: FAIL with "Cannot find module '../ImageForm'".

- [ ] **Step 3: Write the minimal implementation**

Create `src/components/simple-studio-shell/forms/ImageForm.tsx`:

```tsx
"use client";

import { useSimpleStudioStore } from "@/store/simpleStudioStore";
import { Button } from "@/components/ui/button";
import { FormPageLayout } from "./FormPageLayout";
import { FormInfoPanel } from "./FormInfoPanel";

const ASPECT_RATIOS = [
  { value: "1:1", label: "1:1" },
  { value: "16:9", label: "16:9" },
  { value: "9:16", label: "9:16" },
  { value: "4:5", label: "4:5" },
];

const BATCH_PRESETS = [1, 4, 8, 12];

export function ImageForm() {
  const prompt = useSimpleStudioStore((s) => s.prompt);
  const setPrompt = useSimpleStudioStore((s) => s.setPrompt);
  const aspectRatio = useSimpleStudioStore((s) => s.aspectRatio);
  const setAspectRatio = useSimpleStudioStore((s) => s.setAspectRatio);
  const batchCount = useSimpleStudioStore((s) => s.batchCount);
  const setBatchCount = useSimpleStudioStore((s) => s.setBatchCount);
  const isGenerating = useSimpleStudioStore((s) => s.isGenerating);
  const generate = useSimpleStudioStore((s) => s.generate);
  const selectedModelName = useSimpleStudioStore((s) => s.selectedModelName);

  const disabled = isGenerating || prompt.trim().length === 0;

  return (
    <FormPageLayout
      infoPanel={
        <FormInfoPanel
          aspectRatios={ASPECT_RATIOS}
          batchPresets={BATCH_PRESETS}
          currentAspectRatio={aspectRatio}
          onAspectRatioChange={setAspectRatio}
          currentBatchCount={batchCount}
          onBatchCountChange={setBatchCount}
          estimatedCost={<span>{batchCount} image{batchCount > 1 ? "s" : ""}</span>}
          outputExample={
            <div className="aspect-square w-full rounded-md border bg-muted" />
          }
          tips={<p>Describe the scene, style, and subject for best results.</p>}
        />
      }
    >
      <div className="space-y-4">
        <div>
          <label htmlFor="image-prompt" className="mb-2 block text-sm font-medium">
            Prompt
          </label>
          <textarea
            id="image-prompt"
            className="min-h-32 w-full resize-y rounded-md border bg-background p-3 text-sm"
            placeholder="Describe the image you want to generate…"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
          />
        </div>

        <div className="text-xs text-muted-foreground">
          Model: {selectedModelName || "Auto"}
        </div>

        <Button
          type="button"
          size="lg"
          disabled={disabled}
          onClick={() => {
            void generate();
          }}
        >
          {isGenerating ? "Generating…" : "Generate"}
        </Button>
      </div>
    </FormPageLayout>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test:run src/components/simple-studio-shell/forms/__tests__/ImageForm.test.tsx`
Expected: PASS, all 6 tests green.

- [ ] **Step 5: Wire ImageForm into the page**

Replace `src/app/simple-studio/images/page.tsx` with:

```tsx
import { ImageForm } from "@/components/simple-studio-shell/forms/ImageForm";

export default function ImagesPage() {
  return <ImageForm />;
}
```

- [ ] **Step 6: Manual smoke test**

Run: `pnpm dev`, visit `/simple-studio/images` while signed in.

Expected:
- Form renders inline with info panel on the right.
- Typing in the textarea enables the Generate button.
- Clicking Generate triggers the existing generation flow (results appear in the store's `generations` array; they won't render anywhere yet until Task 12's LibraryGallery wires in).

- [ ] **Step 7: Commit**

```bash
git add src/components/simple-studio-shell/forms/ImageForm.tsx src/components/simple-studio-shell/forms/__tests__/ImageForm.test.tsx src/app/simple-studio/images/page.tsx
git commit -m "feat(simple-studio): add ImageForm wired to generation store"
```

---

## Task 10: VideoForm component

**Files:**
- Create: `src/components/simple-studio-shell/forms/VideoForm.tsx`
- Test: `src/components/simple-studio-shell/forms/__tests__/VideoForm.test.tsx`

Analogous to ImageForm with video-specific fields (duration, different aspect ratios).

- [ ] **Step 1: Write the failing test**

Create `src/components/simple-studio-shell/forms/__tests__/VideoForm.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, beforeEach, vi } from "vitest";
import { VideoForm } from "../VideoForm";
import { useSimpleStudioStore } from "@/store/simpleStudioStore";

describe("VideoForm", () => {
  beforeEach(() => {
    useSimpleStudioStore.setState({
      mode: "video",
      prompt: "",
      aspectRatio: "16:9",
      batchCount: 1,
      videoDuration: 5,
      isGenerating: false,
    });
  });

  it("renders a prompt textarea", () => {
    render(<VideoForm />);
    expect(screen.getByLabelText(/prompt/i)).toBeInTheDocument();
  });

  it("renders a Generate button", () => {
    render(<VideoForm />);
    expect(screen.getByRole("button", { name: /generate/i })).toBeInTheDocument();
  });

  it("typing updates the store prompt", async () => {
    render(<VideoForm />);
    await userEvent.type(screen.getByLabelText(/prompt/i), "Sunset");
    expect(useSimpleStudioStore.getState().prompt).toBe("Sunset");
  });

  it("clicking Generate calls the store's generate action", async () => {
    const generateSpy = vi.fn().mockResolvedValue(undefined);
    useSimpleStudioStore.setState({ prompt: "Sunset", generate: generateSpy });
    render(<VideoForm />);
    await userEvent.click(screen.getByRole("button", { name: /generate/i }));
    expect(generateSpy).toHaveBeenCalled();
  });

  it("Generate button is disabled when prompt is empty", () => {
    useSimpleStudioStore.setState({ prompt: "" });
    render(<VideoForm />);
    expect(screen.getByRole("button", { name: /generate/i })).toBeDisabled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test:run src/components/simple-studio-shell/forms/__tests__/VideoForm.test.tsx`
Expected: FAIL with "Cannot find module '../VideoForm'".

- [ ] **Step 3: Write the implementation**

Create `src/components/simple-studio-shell/forms/VideoForm.tsx`:

```tsx
"use client";

import { useSimpleStudioStore } from "@/store/simpleStudioStore";
import { Button } from "@/components/ui/button";
import { FormPageLayout } from "./FormPageLayout";
import { FormInfoPanel } from "./FormInfoPanel";

const ASPECT_RATIOS = [
  { value: "16:9", label: "16:9" },
  { value: "9:16", label: "9:16" },
];

const BATCH_PRESETS = [1, 2, 4];
const DURATIONS = [5, 8, 10];

export function VideoForm() {
  const prompt = useSimpleStudioStore((s) => s.prompt);
  const setPrompt = useSimpleStudioStore((s) => s.setPrompt);
  const aspectRatio = useSimpleStudioStore((s) => s.aspectRatio);
  const setAspectRatio = useSimpleStudioStore((s) => s.setAspectRatio);
  const batchCount = useSimpleStudioStore((s) => s.batchCount);
  const setBatchCount = useSimpleStudioStore((s) => s.setBatchCount);
  const videoDuration = useSimpleStudioStore((s) => s.videoDuration);
  const setVideoDuration = useSimpleStudioStore((s) => s.setVideoDuration);
  const isGenerating = useSimpleStudioStore((s) => s.isGenerating);
  const generate = useSimpleStudioStore((s) => s.generate);
  const selectedModelName = useSimpleStudioStore((s) => s.selectedModelName);

  const disabled = isGenerating || prompt.trim().length === 0;

  return (
    <FormPageLayout
      infoPanel={
        <FormInfoPanel
          aspectRatios={ASPECT_RATIOS}
          batchPresets={BATCH_PRESETS}
          currentAspectRatio={aspectRatio}
          onAspectRatioChange={setAspectRatio}
          currentBatchCount={batchCount}
          onBatchCountChange={setBatchCount}
          estimatedCost={<span>{batchCount} video{batchCount > 1 ? "s" : ""}</span>}
          outputExample={
            <div className="aspect-video w-full rounded-md border bg-muted" />
          }
          tips={<p>Describe the motion and scene. Videos take longer to generate.</p>}
        />
      }
    >
      <div className="space-y-4">
        <div>
          <label htmlFor="video-prompt" className="mb-2 block text-sm font-medium">
            Prompt
          </label>
          <textarea
            id="video-prompt"
            className="min-h-32 w-full resize-y rounded-md border bg-background p-3 text-sm"
            placeholder="Describe the video you want to generate…"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
          />
        </div>

        <div>
          <label className="mb-2 block text-sm font-medium">Duration</label>
          <div className="flex gap-2">
            {DURATIONS.map((d) => (
              <button
                key={d}
                type="button"
                className={`rounded-md border px-3 py-1 text-xs ${
                  videoDuration === d
                    ? "border-primary bg-primary/10"
                    : "border-border hover:bg-muted"
                }`}
                onClick={() => setVideoDuration(d)}
              >
                {d}s
              </button>
            ))}
          </div>
        </div>

        <div className="text-xs text-muted-foreground">
          Model: {selectedModelName || "Auto (Veo 3.1)"}
        </div>

        <Button
          type="button"
          size="lg"
          disabled={disabled}
          onClick={() => {
            void generate();
          }}
        >
          {isGenerating ? "Generating…" : "Generate"}
        </Button>
      </div>
    </FormPageLayout>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test:run src/components/simple-studio-shell/forms/__tests__/VideoForm.test.tsx`
Expected: PASS, all 5 tests green.

- [ ] **Step 5: Wire VideoForm into the page**

Replace `src/app/simple-studio/videos/page.tsx` with:

```tsx
import { VideoForm } from "@/components/simple-studio-shell/forms/VideoForm";

export default function VideosPage() {
  return <VideoForm />;
}
```

- [ ] **Step 6: Commit**

```bash
git add src/components/simple-studio-shell/forms/VideoForm.tsx src/components/simple-studio-shell/forms/__tests__/VideoForm.test.tsx src/app/simple-studio/videos/page.tsx
git commit -m "feat(simple-studio): add VideoForm wired to generation store"
```

---

## Task 11: CopyForm component

**Files:**
- Create: `src/components/simple-studio-shell/forms/CopyForm.tsx`
- Test: `src/components/simple-studio-shell/forms/__tests__/CopyForm.test.tsx`

Copy (text) generation form — no aspect ratio (meaningless for text), adds tone and platform selectors.

- [ ] **Step 1: Write the failing test**

Create `src/components/simple-studio-shell/forms/__tests__/CopyForm.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, beforeEach, vi } from "vitest";
import { CopyForm } from "../CopyForm";
import { useSimpleStudioStore } from "@/store/simpleStudioStore";

describe("CopyForm", () => {
  beforeEach(() => {
    useSimpleStudioStore.setState({
      mode: "copy",
      prompt: "",
      tone: "professional",
      platform: "general",
      copyModelId: "gemini-2.5-flash",
      batchCount: 1,
      isGenerating: false,
    });
  });

  it("renders a prompt textarea", () => {
    render(<CopyForm />);
    expect(screen.getByLabelText(/prompt/i)).toBeInTheDocument();
  });

  it("renders tone and platform selectors", () => {
    render(<CopyForm />);
    expect(screen.getByLabelText(/tone/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/platform/i)).toBeInTheDocument();
  });

  it("renders a Generate button", () => {
    render(<CopyForm />);
    expect(screen.getByRole("button", { name: /generate/i })).toBeInTheDocument();
  });

  it("clicking Generate calls generate", async () => {
    const generateSpy = vi.fn().mockResolvedValue(undefined);
    useSimpleStudioStore.setState({ prompt: "Ad copy", generate: generateSpy });
    render(<CopyForm />);
    await userEvent.click(screen.getByRole("button", { name: /generate/i }));
    expect(generateSpy).toHaveBeenCalled();
  });

  it("Generate is disabled with empty prompt", () => {
    useSimpleStudioStore.setState({ prompt: "" });
    render(<CopyForm />);
    expect(screen.getByRole("button", { name: /generate/i })).toBeDisabled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test:run src/components/simple-studio-shell/forms/__tests__/CopyForm.test.tsx`
Expected: FAIL with "Cannot find module '../CopyForm'".

- [ ] **Step 3: Write the implementation**

Create `src/components/simple-studio-shell/forms/CopyForm.tsx`:

```tsx
"use client";

import { useSimpleStudioStore } from "@/store/simpleStudioStore";
import { Button } from "@/components/ui/button";
import { FormPageLayout } from "./FormPageLayout";
import { FormInfoPanel } from "./FormInfoPanel";

const TONES = ["professional", "casual", "creative", "persuasive"];
const PLATFORMS = ["general", "instagram", "x", "linkedin"];
const BATCH_PRESETS = [1, 4, 8];

export function CopyForm() {
  const prompt = useSimpleStudioStore((s) => s.prompt);
  const setPrompt = useSimpleStudioStore((s) => s.setPrompt);
  const tone = useSimpleStudioStore((s) => s.tone);
  const setTone = useSimpleStudioStore((s) => s.setTone);
  const platform = useSimpleStudioStore((s) => s.platform);
  const setPlatform = useSimpleStudioStore((s) => s.setPlatform);
  const batchCount = useSimpleStudioStore((s) => s.batchCount);
  const setBatchCount = useSimpleStudioStore((s) => s.setBatchCount);
  const isGenerating = useSimpleStudioStore((s) => s.isGenerating);
  const generate = useSimpleStudioStore((s) => s.generate);
  const copyModelId = useSimpleStudioStore((s) => s.copyModelId);

  const disabled = isGenerating || prompt.trim().length === 0;

  return (
    <FormPageLayout
      infoPanel={
        <FormInfoPanel
          batchPresets={BATCH_PRESETS}
          currentBatchCount={batchCount}
          onBatchCountChange={setBatchCount}
          estimatedCost={<span>{batchCount} variant{batchCount > 1 ? "s" : ""}</span>}
          tips={<p>Give the model context: audience, product, and desired action.</p>}
        />
      }
    >
      <div className="space-y-4">
        <div>
          <label htmlFor="copy-prompt" className="mb-2 block text-sm font-medium">
            Prompt
          </label>
          <textarea
            id="copy-prompt"
            className="min-h-32 w-full resize-y rounded-md border bg-background p-3 text-sm"
            placeholder="What should the copy be about?"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label htmlFor="copy-tone" className="mb-2 block text-sm font-medium">
              Tone
            </label>
            <select
              id="copy-tone"
              className="w-full rounded-md border bg-background p-2 text-sm"
              value={tone}
              onChange={(e) => setTone(e.target.value)}
            >
              {TONES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="copy-platform" className="mb-2 block text-sm font-medium">
              Platform
            </label>
            <select
              id="copy-platform"
              className="w-full rounded-md border bg-background p-2 text-sm"
              value={platform}
              onChange={(e) => setPlatform(e.target.value)}
            >
              {PLATFORMS.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="text-xs text-muted-foreground">
          Model: {copyModelId}
        </div>

        <Button
          type="button"
          size="lg"
          disabled={disabled}
          onClick={() => {
            void generate();
          }}
        >
          {isGenerating ? "Generating…" : "Generate"}
        </Button>
      </div>
    </FormPageLayout>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test:run src/components/simple-studio-shell/forms/__tests__/CopyForm.test.tsx`
Expected: PASS, all 5 tests green.

- [ ] **Step 5: Wire CopyForm into the page**

Replace `src/app/simple-studio/copy/page.tsx` with:

```tsx
import { CopyForm } from "@/components/simple-studio-shell/forms/CopyForm";

export default function CopyPage() {
  return <CopyForm />;
}
```

- [ ] **Step 6: Commit**

```bash
git add src/components/simple-studio-shell/forms/CopyForm.tsx src/components/simple-studio-shell/forms/__tests__/CopyForm.test.tsx src/app/simple-studio/copy/page.tsx
git commit -m "feat(simple-studio): add CopyForm with tone and platform controls"
```

---

## Task 12: LibraryGallery component

**Files:**
- Create: `src/components/simple-studio-shell/LibraryGallery.tsx`
- Test: `src/components/simple-studio-shell/__tests__/LibraryGallery.test.tsx`

Cross-mode generations grid that reads from `useSimpleStudioStore.generationsByMode` and filters by `useSimpleStudioShellStore.libraryModeFilter`.

- [ ] **Step 1: Write the failing test**

Create `src/components/simple-studio-shell/__tests__/LibraryGallery.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it, beforeEach } from "vitest";
import { LibraryGallery } from "../LibraryGallery";
import { useSimpleStudioStore, type Generation } from "@/store/simpleStudioStore";
import { useSimpleStudioShellStore } from "@/store/simpleStudioShellStore";

function makeGen(overrides: Partial<Generation>): Generation {
  return {
    id: "g1",
    batchId: "b1",
    status: "complete",
    result: "data:image/png;base64,xxx",
    assetId: null,
    error: null,
    mode: "photo",
    aspectRatio: "1:1",
    prompt: "A cat",
    createdAt: Date.now(),
    modelName: "Auto",
    ...overrides,
  };
}

describe("LibraryGallery", () => {
  beforeEach(() => {
    useSimpleStudioStore.setState({
      generationsByMode: {
        photo: [makeGen({ id: "p1", mode: "photo", prompt: "Photo one" })],
        video: [makeGen({ id: "v1", mode: "video", prompt: "Video one", result: "data:video/mp4;base64,xxx" })],
        copy: [makeGen({ id: "c1", mode: "copy", prompt: "Copy one", result: "Text output" })],
      },
      generations: [],
      mode: "photo",
    });
    useSimpleStudioShellStore.setState({ libraryModeFilter: "all" });
  });

  it("renders all generations when filter is 'all'", () => {
    render(<LibraryGallery />);
    expect(screen.getByText("Photo one")).toBeInTheDocument();
    expect(screen.getByText("Video one")).toBeInTheDocument();
    expect(screen.getByText("Copy one")).toBeInTheDocument();
  });

  it("renders only photo generations when filter is 'photo'", () => {
    useSimpleStudioShellStore.setState({ libraryModeFilter: "photo" });
    render(<LibraryGallery />);
    expect(screen.getByText("Photo one")).toBeInTheDocument();
    expect(screen.queryByText("Video one")).not.toBeInTheDocument();
    expect(screen.queryByText("Copy one")).not.toBeInTheDocument();
  });

  it("renders only video generations when filter is 'video'", () => {
    useSimpleStudioShellStore.setState({ libraryModeFilter: "video" });
    render(<LibraryGallery />);
    expect(screen.queryByText("Photo one")).not.toBeInTheDocument();
    expect(screen.getByText("Video one")).toBeInTheDocument();
    expect(screen.queryByText("Copy one")).not.toBeInTheDocument();
  });

  it("renders only copy generations when filter is 'copy'", () => {
    useSimpleStudioShellStore.setState({ libraryModeFilter: "copy" });
    render(<LibraryGallery />);
    expect(screen.queryByText("Photo one")).not.toBeInTheDocument();
    expect(screen.queryByText("Video one")).not.toBeInTheDocument();
    expect(screen.getByText("Copy one")).toBeInTheDocument();
  });

  it("renders an empty state when there are no generations", () => {
    useSimpleStudioStore.setState({
      generationsByMode: { photo: [], video: [], copy: [] },
      generations: [],
    });
    render(<LibraryGallery />);
    expect(screen.getByText(/no generations yet/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test:run src/components/simple-studio-shell/__tests__/LibraryGallery.test.tsx`
Expected: FAIL with "Cannot find module '../LibraryGallery'".

- [ ] **Step 3: Write the implementation**

Create `src/components/simple-studio-shell/LibraryGallery.tsx`:

```tsx
"use client";

import { useMemo } from "react";
import Link from "next/link";
import { useSimpleStudioStore, type Generation } from "@/store/simpleStudioStore";
import { useSimpleStudioShellStore } from "@/store/simpleStudioShellStore";

function GenerationCard({ gen }: { gen: Generation }) {
  if (gen.mode === "copy") {
    return (
      <div className="rounded-lg border p-4">
        <div className="mb-2 text-xs text-muted-foreground">
          copy · {new Date(gen.createdAt).toLocaleDateString()}
        </div>
        <div className="mb-2 text-sm font-medium line-clamp-2">{gen.prompt}</div>
        <div className="text-sm line-clamp-4 whitespace-pre-wrap">
          {gen.result ?? "(no output)"}
        </div>
      </div>
    );
  }

  if (gen.mode === "video") {
    return (
      <div className="rounded-lg border overflow-hidden">
        <div className="aspect-video bg-muted">
          {gen.result && (
            <video
              src={gen.result}
              className="h-full w-full object-cover"
              muted
              playsInline
            />
          )}
        </div>
        <div className="p-3">
          <div className="mb-1 text-xs text-muted-foreground">
            video · {new Date(gen.createdAt).toLocaleDateString()}
          </div>
          <div className="text-sm line-clamp-2">{gen.prompt}</div>
        </div>
      </div>
    );
  }

  // photo
  return (
    <div className="rounded-lg border overflow-hidden">
      <div className="aspect-square bg-muted">
        {gen.result && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={gen.result} alt={gen.prompt} className="h-full w-full object-cover" />
        )}
      </div>
      <div className="p-3">
        <div className="mb-1 text-xs text-muted-foreground">
          photo · {new Date(gen.createdAt).toLocaleDateString()}
        </div>
        <div className="text-sm line-clamp-2">{gen.prompt}</div>
      </div>
    </div>
  );
}

export function LibraryGallery() {
  const generationsByMode = useSimpleStudioStore((s) => s.generationsByMode);
  const filter = useSimpleStudioShellStore((s) => s.libraryModeFilter);

  const visible = useMemo(() => {
    const all = [
      ...generationsByMode.photo,
      ...generationsByMode.video,
      ...generationsByMode.copy,
    ].sort((a, b) => b.createdAt - a.createdAt);
    if (filter === "all") return all;
    return all.filter((g) => g.mode === filter);
  }, [generationsByMode, filter]);

  if (visible.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-4 p-12 text-center">
        <div className="text-sm text-muted-foreground">No generations yet.</div>
        <div className="flex gap-2">
          <Link
            href="/simple-studio/images"
            className="rounded-md border px-3 py-1 text-sm hover:bg-muted"
          >
            Create images
          </Link>
          <Link
            href="/simple-studio/videos"
            className="rounded-md border px-3 py-1 text-sm hover:bg-muted"
          >
            Create videos
          </Link>
          <Link
            href="/simple-studio/copy"
            className="rounded-md border px-3 py-1 text-sm hover:bg-muted"
          >
            Write copy
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 gap-4 p-6 md:grid-cols-3 lg:grid-cols-4">
      {visible.map((gen) => (
        <GenerationCard key={gen.id} gen={gen} />
      ))}
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test:run src/components/simple-studio-shell/__tests__/LibraryGallery.test.tsx`
Expected: PASS, all 5 tests green.

- [ ] **Step 5: Wire LibraryGallery into the page**

Replace `src/app/simple-studio/library/page.tsx` with:

```tsx
import { LibraryGallery } from "@/components/simple-studio-shell/LibraryGallery";

export default function LibraryPage() {
  return <LibraryGallery />;
}
```

- [ ] **Step 6: Commit**

```bash
git add src/components/simple-studio-shell/LibraryGallery.tsx src/components/simple-studio-shell/__tests__/LibraryGallery.test.tsx src/app/simple-studio/library/page.tsx
git commit -m "feat(simple-studio): add LibraryGallery with mode filter"
```

---

## Task 13: SavePromptDialog component

**Files:**
- Create: `src/components/simple-studio-shell/SavePromptDialog.tsx`
- Test: `src/components/simple-studio-shell/__tests__/SavePromptDialog.test.tsx`

A shadcn Dialog that asks for a name and calls `useSimpleStudioStore.saveCurrentPrompt(name)`. The dialog open state is owned by `useSimpleStudioShellStore`.

- [ ] **Step 1: Write the failing test**

Create `src/components/simple-studio-shell/__tests__/SavePromptDialog.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, beforeEach, vi } from "vitest";
import { SavePromptDialog } from "../SavePromptDialog";
import { useSimpleStudioStore } from "@/store/simpleStudioStore";
import { useSimpleStudioShellStore } from "@/store/simpleStudioShellStore";

describe("SavePromptDialog", () => {
  beforeEach(() => {
    useSimpleStudioShellStore.setState({ savePromptDialogOpen: true });
    useSimpleStudioStore.setState({ prompt: "A cat", mode: "photo" });
  });

  it("renders the dialog when open is true", () => {
    render(<SavePromptDialog />);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("shows a name input", () => {
    render(<SavePromptDialog />);
    expect(screen.getByLabelText(/name/i)).toBeInTheDocument();
  });

  it("shows an editable prompt textarea seeded with the current store prompt", () => {
    render(<SavePromptDialog />);
    const textarea = screen.getByLabelText(/prompt text/i) as HTMLTextAreaElement;
    expect(textarea).toBeInTheDocument();
    expect(textarea.value).toBe("A cat");
  });

  it("calls setPrompt then saveCurrentPrompt with the edited prompt on Save", async () => {
    const setPromptSpy = vi.fn();
    const saveSpy = vi.fn().mockResolvedValue(undefined);
    useSimpleStudioStore.setState({ setPrompt: setPromptSpy, saveCurrentPrompt: saveSpy });
    render(<SavePromptDialog />);
    const textarea = screen.getByLabelText(/prompt text/i);
    await userEvent.clear(textarea);
    await userEvent.type(textarea, "A fluffy cat");
    await userEvent.type(screen.getByLabelText(/name/i), "Cat v2");
    await userEvent.click(screen.getByRole("button", { name: /^save$/i }));
    expect(setPromptSpy).toHaveBeenCalledWith("A fluffy cat");
    expect(saveSpy).toHaveBeenCalledWith("Cat v2");
    expect(useSimpleStudioShellStore.getState().savePromptDialogOpen).toBe(false);
  });

  it("Save button is disabled when name is empty", () => {
    render(<SavePromptDialog />);
    expect(screen.getByRole("button", { name: /^save$/i })).toBeDisabled();
  });

  it("Save button is disabled when prompt text is empty", async () => {
    useSimpleStudioStore.setState({ prompt: "" });
    render(<SavePromptDialog />);
    await userEvent.type(screen.getByLabelText(/name/i), "Empty");
    expect(screen.getByRole("button", { name: /^save$/i })).toBeDisabled();
  });

  it("does not render when open is false", () => {
    useSimpleStudioShellStore.setState({ savePromptDialogOpen: false });
    render(<SavePromptDialog />);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test:run src/components/simple-studio-shell/__tests__/SavePromptDialog.test.tsx`
Expected: FAIL with "Cannot find module '../SavePromptDialog'".

- [ ] **Step 3: Write the implementation**

Create `src/components/simple-studio-shell/SavePromptDialog.tsx`:

```tsx
"use client";

import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useSimpleStudioStore } from "@/store/simpleStudioStore";
import { useSimpleStudioShellStore } from "@/store/simpleStudioShellStore";

export function SavePromptDialog() {
  const open = useSimpleStudioShellStore((s) => s.savePromptDialogOpen);
  const closeDialog = useSimpleStudioShellStore((s) => s.closeSavePromptDialog);
  const storePrompt = useSimpleStudioStore((s) => s.prompt);
  const mode = useSimpleStudioStore((s) => s.mode);
  const setPrompt = useSimpleStudioStore((s) => s.setPrompt);
  const saveCurrentPrompt = useSimpleStudioStore((s) => s.saveCurrentPrompt);

  const [name, setName] = useState("");
  const [promptText, setPromptText] = useState(storePrompt);
  const [saving, setSaving] = useState(false);

  // Re-seed the dialog's local prompt from the store whenever the dialog opens
  useEffect(() => {
    if (open) {
      setPromptText(storePrompt);
      setName("");
    }
  }, [open, storePrompt]);

  const disabled =
    saving || name.trim().length === 0 || promptText.trim().length === 0;

  const handleSave = async () => {
    if (disabled) return;
    setSaving(true);
    try {
      // If the user edited the prompt in the dialog, push it to the store
      // so saveCurrentPrompt picks it up.
      if (promptText !== storePrompt) {
        setPrompt(promptText);
      }
      await saveCurrentPrompt(name.trim());
      closeDialog();
    } finally {
      setSaving(false);
    }
  };

  const handleOpenChange = (next: boolean) => {
    if (!next) closeDialog();
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Save prompt</DialogTitle>
          <DialogDescription>
            Save a {mode} prompt to your library for later use.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div>
            <label htmlFor="save-prompt-name" className="mb-1 block text-sm font-medium">
              Name
            </label>
            <input
              id="save-prompt-name"
              type="text"
              className="w-full rounded-md border bg-background p-2 text-sm"
              placeholder="e.g. Cinematic sunset"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
            />
          </div>

          <div>
            <label
              htmlFor="save-prompt-text"
              className="mb-1 block text-sm font-medium"
            >
              Prompt text
            </label>
            <textarea
              id="save-prompt-text"
              className="max-h-48 min-h-24 w-full resize-y rounded-md border bg-background p-2 text-sm"
              placeholder="Describe the prompt…"
              value={promptText}
              onChange={(e) => setPromptText(e.target.value)}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => handleOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={disabled}>
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test:run src/components/simple-studio-shell/__tests__/SavePromptDialog.test.tsx`
Expected: PASS, all 6 tests green.

- [ ] **Step 5: Mount the dialog in SimpleStudioLayout**

Edit `src/components/simple-studio-shell/SimpleStudioLayout.tsx`. Add the import and render `<SavePromptDialog />` inside the `SidebarInset` just after the header:

```tsx
import { SavePromptDialog } from "./SavePromptDialog";

// …inside <SidebarInset>…
<SimpleStudioSiteHeader />
<div className="flex flex-1 flex-col">{children}</div>
<SavePromptDialog />
```

- [ ] **Step 6: Commit**

```bash
git add src/components/simple-studio-shell/SavePromptDialog.tsx src/components/simple-studio-shell/__tests__/SavePromptDialog.test.tsx src/components/simple-studio-shell/SimpleStudioLayout.tsx
git commit -m "feat(simple-studio): add SavePromptDialog with name + preview"
```

---

## Task 14: PromptLibraryTabs component

**Files:**
- Create: `src/components/simple-studio-shell/PromptLibraryTabs.tsx`
- Test: `src/components/simple-studio-shell/__tests__/PromptLibraryTabs.test.tsx`

Tabs for Templates (public prompts) and Saved (private prompts).

- [ ] **Step 1: Write the failing test**

Create `src/components/simple-studio-shell/__tests__/PromptLibraryTabs.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, beforeEach, vi } from "vitest";
import { PromptLibraryTabs } from "../PromptLibraryTabs";
import {
  useSimpleStudioStore,
  type SavedPrompt,
} from "@/store/simpleStudioStore";
import { useSimpleStudioShellStore } from "@/store/simpleStudioShellStore";

const routerPush = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: routerPush }),
}));

function makePrompt(overrides: Partial<SavedPrompt>): SavedPrompt {
  return {
    id: "p1",
    mode: "photo",
    name: "Demo",
    promptText: "Demo prompt",
    formConfig: {},
    isPublic: false,
    ...overrides,
  };
}

describe("PromptLibraryTabs", () => {
  beforeEach(() => {
    routerPush.mockClear();
    useSimpleStudioShellStore.setState({ promptLibraryTab: "templates" });
    useSimpleStudioStore.setState({
      savedPrompts: [
        makePrompt({ id: "s1", name: "Saved one", promptText: "Saved text" }),
      ],
      publicPrompts: [
        makePrompt({
          id: "t1",
          name: "Template one",
          promptText: "Template text",
          isPublic: true,
        }),
      ],
      applyPrompt: vi.fn(),
      loadSavedPrompts: vi.fn().mockResolvedValue(undefined),
      loadPublicPrompts: vi.fn().mockResolvedValue(undefined),
    });
  });

  it("shows templates by default", () => {
    render(<PromptLibraryTabs />);
    expect(screen.getByText("Template one")).toBeInTheDocument();
  });

  it("switches to Saved tab on click", async () => {
    render(<PromptLibraryTabs />);
    await userEvent.click(screen.getByRole("tab", { name: /saved/i }));
    expect(screen.getByText("Saved one")).toBeInTheDocument();
    expect(useSimpleStudioShellStore.getState().promptLibraryTab).toBe("saved");
  });

  it("clicking Use on a template applies and navigates", async () => {
    const applySpy = vi.fn();
    useSimpleStudioStore.setState({ applyPrompt: applySpy });
    render(<PromptLibraryTabs />);
    await userEvent.click(screen.getByRole("button", { name: /use/i }));
    expect(applySpy).toHaveBeenCalled();
    expect(routerPush).toHaveBeenCalledWith("/simple-studio/images");
  });

  it("shows empty state when no templates", () => {
    useSimpleStudioStore.setState({ publicPrompts: [] });
    render(<PromptLibraryTabs />);
    expect(screen.getByText(/no templates yet/i)).toBeInTheDocument();
  });

  it("shows empty state when no saved prompts", async () => {
    useSimpleStudioStore.setState({ savedPrompts: [] });
    render(<PromptLibraryTabs />);
    await userEvent.click(screen.getByRole("tab", { name: /saved/i }));
    expect(screen.getByText(/no saved prompts yet/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test:run src/components/simple-studio-shell/__tests__/PromptLibraryTabs.test.tsx`
Expected: FAIL with "Cannot find module '../PromptLibraryTabs'".

- [ ] **Step 3: Write the implementation**

Create `src/components/simple-studio-shell/PromptLibraryTabs.tsx`:

```tsx
"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import {
  useSimpleStudioStore,
  type SavedPrompt,
} from "@/store/simpleStudioStore";
import { useSimpleStudioShellStore } from "@/store/simpleStudioShellStore";
import { MODE_TO_URL_SEGMENT } from "./urlToMode";

function PromptCard({
  prompt,
  onUse,
}: {
  prompt: SavedPrompt;
  onUse: (p: SavedPrompt) => void;
}) {
  return (
    <div className="flex flex-col gap-2 rounded-lg border p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="font-medium text-sm">{prompt.name}</div>
        <span className="text-xs rounded-full border px-2 py-0.5 text-muted-foreground">
          {prompt.mode}
        </span>
      </div>
      <div className="text-xs text-muted-foreground line-clamp-3">
        {prompt.promptText}
      </div>
      <div className="pt-2">
        <Button size="sm" onClick={() => onUse(prompt)}>
          Use
        </Button>
      </div>
    </div>
  );
}

export function PromptLibraryTabs() {
  const router = useRouter();
  const tab = useSimpleStudioShellStore((s) => s.promptLibraryTab);
  const setTab = useSimpleStudioShellStore((s) => s.setPromptLibraryTab);

  const savedPrompts = useSimpleStudioStore((s) => s.savedPrompts);
  const publicPrompts = useSimpleStudioStore((s) => s.publicPrompts);
  const loadSavedPrompts = useSimpleStudioStore((s) => s.loadSavedPrompts);
  const loadPublicPrompts = useSimpleStudioStore((s) => s.loadPublicPrompts);
  const applyPrompt = useSimpleStudioStore((s) => s.applyPrompt);

  useEffect(() => {
    void loadSavedPrompts();
    void loadPublicPrompts();
  }, [loadSavedPrompts, loadPublicPrompts]);

  const handleUse = (prompt: SavedPrompt) => {
    applyPrompt(prompt);
    router.push(`/simple-studio/${MODE_TO_URL_SEGMENT[prompt.mode]}`);
  };

  return (
    <div className="p-6">
      <Tabs value={tab} onValueChange={(v) => setTab(v as "templates" | "saved")}>
        <TabsList>
          <TabsTrigger value="templates">Templates</TabsTrigger>
          <TabsTrigger value="saved">Saved</TabsTrigger>
        </TabsList>

        <TabsContent value="templates">
          {publicPrompts.length === 0 ? (
            <div className="rounded-lg border p-12 text-center text-sm text-muted-foreground">
              No templates yet.
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
              {publicPrompts.map((p) => (
                <PromptCard key={p.id} prompt={p} onUse={handleUse} />
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="saved">
          {savedPrompts.length === 0 ? (
            <div className="rounded-lg border p-12 text-center text-sm text-muted-foreground">
              No saved prompts yet. Save one from any creation page.
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
              {savedPrompts.map((p) => (
                <PromptCard key={p.id} prompt={p} onUse={handleUse} />
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test:run src/components/simple-studio-shell/__tests__/PromptLibraryTabs.test.tsx`
Expected: PASS, all 5 tests green.

- [ ] **Step 5: Wire PromptLibraryTabs into the page**

Replace `src/app/simple-studio/prompt-library/page.tsx` with:

```tsx
import { PromptLibraryTabs } from "@/components/simple-studio-shell/PromptLibraryTabs";

export default function PromptLibraryPage() {
  return <PromptLibraryTabs />;
}
```

- [ ] **Step 6: Commit**

```bash
git add src/components/simple-studio-shell/PromptLibraryTabs.tsx src/components/simple-studio-shell/__tests__/PromptLibraryTabs.test.tsx src/app/simple-studio/prompt-library/page.tsx
git commit -m "feat(simple-studio): add PromptLibraryTabs with templates + saved"
```

---

## Task 15: Full verification pass

**Files:** none modified — this task runs the verification checklist from the spec.

- [ ] **Step 1: Run the full test suite**

Run: `pnpm test:run`
Expected: all tests pass, including every new test from Tasks 1-14 plus all pre-existing tests.

If any pre-existing test fails, compare against the baseline recorded in Prerequisites step 4. If the failure is new, investigate before proceeding.

- [ ] **Step 2: Run lint**

Run: `pnpm lint`
Expected: no errors. Fix any lint errors in-place before proceeding (do not bypass).

- [ ] **Step 3: Run a production build**

Run: `pnpm build`
Expected: build succeeds with no TypeScript errors.

- [ ] **Step 4: Manual verification against spec checklist**

Run: `pnpm dev`, then walk through every item in the spec's "Verification checklist (manual QA before merging PR 1)" section (items 1-14). For each item:
- If the item passes, mark it off mentally.
- If it fails, record the exact failure. Stop the verification pass and open a follow-up task before continuing.

Key items to pay attention to:
- Item 4: navigating between form routes updates `useSimpleStudioStore.mode` (verifiable in React DevTools — expand the store and watch `mode` change as you click nav items).
- Item 6: generating an image/video/copy from a form route causes it to appear in `/simple-studio/library` under the right filter.
- Item 8: if the `saved_prompts` table has any rows with `isPublic: true`, they show in the Templates tab. If not, empty state is visible.
- Item 13: visiting `/studio/simple` still renders the legacy UI unchanged.

- [ ] **Step 5: Commit verification notes (if needed)**

If the verification pass reveals anything that needs documentation (e.g., a known issue to flag in the PR description), add a short note to a local file — don't touch committed code.

- [ ] **Step 6: Push the branch**

```bash
git push -u origin feature/simple-studio-dashboard-shell
```

Do NOT open the PR yet. Tell the user the branch is pushed and the verification checklist has been walked. They will open the PR after confirming.

---

## Appendix A: PR 2 — Old code deletion (separate PR, NOT part of this plan)

Per the spec, PR 2 is a separate follow-up that happens AFTER PR 1 has been merged and the verification window has passed. It is listed here for context only — do NOT execute it as part of this plan.

PR 2 scope:
1. Delete `src/app/studio/simple/page.tsx`, `src/app/studio/simple/SimpleStudioClient.tsx`, and `src/app/studio/simple/__tests__/`.
2. Delete the entire `src/components/simple-studio/` directory after `grep -rn "from.*simple-studio/"` confirms no new files reference it.
3. Recreate `src/app/studio/simple/page.tsx` with a redirect stub:
   ```tsx
   import { redirect } from "next/navigation";
   export default function Page() {
     redirect("/simple-studio/images");
   }
   ```
4. Re-run the full verification checklist excluding item 13 (which tests the old UI).
5. Commit and open PR 2 against `develop`.

---

## Appendix B: Known follow-ups

These are out of scope for PR 1 and PR 2 but worth tracking as separate issues:

- **Seed public prompt templates.** The Templates tab is empty until rows with `isPublic: true` exist in `saved_prompts`. Options: (a) SQL seed script in `scripts/db-seed.mjs`, (b) a one-off admin POST, (c) a dedicated seed route. Recommend option (a).
- **Extract shared form primitives.** After PR 2 deletes the old `Sidebar.tsx`, extracting truly shared primitives (PromptTextarea, ModelPicker, ReferenceImageUpload) from the three new form components becomes safe. Not worth doing until then.
- **Cost estimation.** `FormInfoPanel` currently shows a hardcoded batch count string as "Estimated cost". A real estimate would read from a pricing table keyed by `selectedModelId` + `batchCount` + `videoDuration`. Non-blocking — the current text is honest ("N images/videos/variants").
- **Reference image upload in ImageForm/VideoForm.** The existing store supports `referenceImages` and `sourceImage`; wiring them into the new forms requires porting the drop-zone UI from the old `Sidebar.tsx` or writing fresh. Defer to a follow-up.
- **Edit and delete saved prompts from PromptLibraryTabs.** The existing PATCH and DELETE endpoints exist; only the UI affordances are missing. Add in a follow-up once there's real user demand.
- **Library preview modal, regenerate, delete actions.** LibraryGallery currently renders cards without click handlers. A detail modal with full resolution + actions is a natural follow-up.
