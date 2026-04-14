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
