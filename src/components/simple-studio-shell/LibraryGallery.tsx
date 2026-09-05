"use client";

import { useMemo } from "react";
import Link from "next/link";
import { useSimpleStudioStore, type Generation } from "@/store/simpleStudioStore";
import { useSimpleStudioShellStore } from "@/store/simpleStudioShellStore";
import { useFormatter, useTranslations } from "next-intl";

function GenerationCard({ gen }: { gen: Generation }) {
  const t = useTranslations("studioUi.library");
  const format = useFormatter();
  const createdAt = format.dateTime(new Date(gen.createdAt), { dateStyle: "medium" });
  if (gen.mode === "copy") {
    return (
      <div className="rounded-lg border p-4">
        <div className="mb-2 text-xs text-muted-foreground">
          {t("type.copy")} · <bdi>{createdAt}</bdi>
        </div>
        <div dir="auto" className="mb-2 text-sm font-medium line-clamp-2">{gen.prompt}</div>
        <div dir="auto" className="text-sm line-clamp-4 whitespace-pre-wrap">
          {gen.result ?? t("noOutput")}
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
            {t("type.video")} · <bdi>{createdAt}</bdi>
          </div>
          <div dir="auto" className="text-sm line-clamp-2">{gen.prompt}</div>
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
          <img dir="auto" src={gen.result} alt={gen.prompt} className="h-full w-full object-cover" />
        )}
      </div>
      <div className="p-3">
        <div className="mb-1 text-xs text-muted-foreground">
          {t("type.photo")} · <bdi>{createdAt}</bdi>
        </div>
        <div dir="auto" className="text-sm line-clamp-2">{gen.prompt}</div>
      </div>
    </div>
  );
}

export function LibraryGallery() {
  const t = useTranslations("studioUi.library");
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
      <main className="flex flex-1 flex-col items-center justify-center gap-4 p-12 text-center">
        <div className="text-sm text-muted-foreground">{t("empty")}</div>
        <div className="flex gap-2">
          <Link
            href="/simple-studio/images"
            className="rounded-md border px-3 py-1 text-sm hover:bg-muted"
          >
            {t("createImages")}
          </Link>
          <Link
            href="/simple-studio/videos"
            className="rounded-md border px-3 py-1 text-sm hover:bg-muted"
          >
            {t("createVideos")}
          </Link>
          <Link
            href="/simple-studio/copy"
            className="rounded-md border px-3 py-1 text-sm hover:bg-muted"
          >
            {t("writeCopy")}
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main className="grid grid-cols-2 gap-4 p-6 md:grid-cols-3 lg:grid-cols-4">
      {visible.map((gen) => (
        <GenerationCard key={gen.id} gen={gen} />
      ))}
    </main>
  );
}
