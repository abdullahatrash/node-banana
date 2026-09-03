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
        </>
  );
}
