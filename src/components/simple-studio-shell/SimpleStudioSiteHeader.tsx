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
import { useTranslations } from "next-intl";

const PAGE_TITLES = {
  "/simple-studio/images": "images",
  "/simple-studio/videos": "videos",
  "/simple-studio/copy": "copy",
  "/simple-studio/library": "library",
  "/simple-studio/prompt-library": "promptLibrary",
} as const;

const FILTER_VALUES: { value: LibraryModeFilter }[] = [
  { value: "all" },
  { value: "photo" },
  { value: "video" },
  { value: "copy" },
];

function resolveTitleKey(pathname: string | null): keyof typeof PAGE_TITLES | null {
  if (!pathname) return null;
  if (pathname in PAGE_TITLES) return pathname as keyof typeof PAGE_TITLES;
  const prefixMatch = Object.entries(PAGE_TITLES).find(([path]) =>
    pathname.startsWith(path + "/"),
  );
  return prefixMatch ? prefixMatch[0] as keyof typeof PAGE_TITLES : null;
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
  const t = useTranslations("shell");
  const titleKey = resolveTitleKey(pathname);
  const title = titleKey ? t(`routes.${PAGE_TITLES[titleKey]}`) : t("areas.simpleStudio");
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
                {t(`filters.${f.value}`)}
              </Button>
            ))}

          {isForm && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => openSavePromptDialog()}
            >
              <BookmarkIcon className="size-4" />
              {t("actions.savePrompt")}
            </Button>
          )}

          {isPromptLibrary && (
            <Button size="sm" onClick={() => openSavePromptDialog()}>
              <PlusIcon className="size-4" />
              {t("actions.newSavedPrompt")}
            </Button>
          )}
        </div>
      </div>
    </header>
  );
}
