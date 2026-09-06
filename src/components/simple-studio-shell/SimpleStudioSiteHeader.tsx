"use client";

import { usePathname } from "next/navigation";
import { PlusIcon, BookmarkIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  useSimpleStudioShellStore,
  type LibraryModeFilter,
} from "@/store/simpleStudioShellStore";
import { useTranslations } from "next-intl";

const FILTER_VALUES: { value: LibraryModeFilter }[] = [
  { value: "all" },
  { value: "photo" },
  { value: "video" },
  { value: "copy" },
];

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

export function SimpleStudioHeaderActions() {
  const pathname = usePathname();
  const t = useTranslations("shell");
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
        <>
          {isLibrary && (
            <>
              <select
                aria-label={t("filtersLabel")}
                className="h-9 max-w-24 rounded-lg border border-input bg-background px-2 text-sm xl:hidden"
                value={libraryModeFilter}
                onChange={(event) => setLibraryModeFilter(event.target.value as LibraryModeFilter)}
              >
                {FILTER_VALUES.map((filter) => (
                  <option key={filter.value} value={filter.value}>{t(`filters.${filter.value}`)}</option>
                ))}
              </select>
              <div className="hidden items-center gap-1 xl:flex">
                {FILTER_VALUES.map((filter) => (
                  <Button
                    key={filter.value}
                    size="sm"
                    variant={libraryModeFilter === filter.value ? "default" : "ghost"}
                    onClick={() => setLibraryModeFilter(filter.value)}
                  >
                    {t(`filters.${filter.value}`)}
                  </Button>
                ))}
              </div>
            </>
          )}

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
            <Button
              size="sm"
              aria-label={t("actions.newSavedPrompt")}
              title={t("actions.newSavedPrompt")}
              onClick={() => openSavePromptDialog()}
            >
              <PlusIcon className="size-4" />
            </Button>
          )}
        </>
  );
}
