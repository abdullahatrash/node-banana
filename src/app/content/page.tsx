import Link from "next/link";
import { FileTextIcon, ImageIcon, LibraryIcon, VideoIcon } from "lucide-react";
import { getTranslations } from "next-intl/server";

const availableContentSurfaces = [
  { key: "copy", href: "/simple-studio/copy", icon: FileTextIcon },
  { key: "images", href: "/simple-studio/images", icon: ImageIcon },
  { key: "videos", href: "/simple-studio/videos", icon: VideoIcon },
  { key: "posts", href: "/social/posts", icon: LibraryIcon },
] as const;

export default async function ContentPage() {
  const t = await getTranslations("shell.contentHub");
  return (
    <main className="flex flex-1 flex-col px-5 py-8 sm:px-8 lg:px-12">
      <div className="mx-auto w-full max-w-5xl">
        <h2 className="text-3xl font-semibold tracking-tight">{t("title")}</h2>
        <p className="mt-3 max-w-2xl text-sm leading-7 text-muted-foreground">
          {t("description")}
        </p>
        <div className="mt-8 grid gap-4 sm:grid-cols-2">
          {availableContentSurfaces.map((surface) => (
            <Link
              key={surface.key}
              href={surface.href}
              className="flex items-start gap-4 rounded-2xl border bg-card p-5 outline-none transition hover:border-amber-500/50 focus-visible:ring-2 focus-visible:ring-ring"
            >
              <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-muted">
                <surface.icon className="size-5" />
              </span>
              <span>
                <span className="block font-semibold">{t(`${surface.key}Title`)}</span>
                <span className="mt-1 block text-sm leading-6 text-muted-foreground">
                  {t(`${surface.key}Description`)}
                </span>
              </span>
            </Link>
          ))}
        </div>
      </div>
    </main>
  );
}
