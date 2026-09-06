"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { CalendarDaysIcon, ImageIcon, PenLineIcon, SparklesIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";

export function AuthShell({ title, description, children, footer }: {
  title: string;
  description: string;
  children: ReactNode;
  footer: ReactNode;
}) {
  const t = useTranslations("auth.shell");
  const shell = useTranslations("shell");

  return (
    <main className="min-h-svh bg-background text-foreground lg:grid lg:grid-cols-2">
      <aside className="relative hidden overflow-hidden bg-stone-950 px-12 py-12 text-stone-50 lg:flex lg:flex-col xl:px-20">
        <Link href="/" className="relative z-10 flex w-fit items-center gap-3 rounded-lg font-semibold outline-none focus-visible:ring-2 focus-visible:ring-amber-300">
          <span className="flex size-10 items-center justify-center rounded-xl bg-amber-300 text-stone-950">
            <ImageIcon className="size-5" aria-hidden="true" />
          </span>
          <span className="text-xl">{shell("brandName")}</span>
        </Link>

        <div className="relative z-10 mx-auto flex w-full max-w-lg flex-1 flex-col justify-center py-16">
          <div className="mb-7 flex items-center gap-2 text-sm text-amber-200">
            <SparklesIcon className="size-4" aria-hidden="true" />
            {t("eyebrow")}
          </div>
          <h2 className="max-w-md text-4xl font-semibold leading-[1.35] tracking-tight xl:text-5xl">{t("title")}</h2>
          <p className="mt-6 max-w-sm text-base leading-8 text-stone-400">{t("description")}</p>

          <div aria-hidden="true" className="relative mt-14 h-56 select-none">
            <div className="absolute start-0 top-7 w-[47%] -rotate-6 rounded-2xl border border-white/15 bg-stone-900 p-3 shadow-xl">
              <div className="relative h-28 overflow-hidden rounded-xl bg-amber-200">
                <div className="absolute -bottom-8 start-8 size-32 rounded-full bg-amber-500" />
                <div className="absolute end-4 top-5 h-28 w-16 rotate-12 rounded-t-full bg-stone-800" />
                <div className="absolute start-5 top-5 size-6 rounded-full bg-white/70" />
              </div>
              <div className="flex items-center gap-2 px-1 pb-1 pt-4 text-xs text-stone-300"><ImageIcon className="size-4" />{shell("primary.aiStudio")}</div>
            </div>
            <div className="absolute end-1 top-0 w-[48%] rotate-6 rounded-2xl border border-white/15 bg-stone-800 p-5 shadow-xl">
              <PenLineIcon className="mb-4 size-5 text-amber-200" />
              <div className="mb-2 h-2 w-4/5 rounded bg-stone-500" />
              <div className="mb-2 h-2 w-full rounded bg-stone-600" />
              <div className="mb-5 h-2 w-3/5 rounded bg-stone-600" />
              <span className="text-xs text-stone-300">{shell("primary.content")}</span>
            </div>
            <div className="absolute bottom-0 end-3 flex items-center gap-3 rounded-xl border border-white/15 bg-stone-900 px-5 py-4 shadow-xl">
              <span className="flex size-9 items-center justify-center rounded-lg bg-amber-300/10 text-amber-200"><CalendarDaysIcon className="size-4" /></span>
              <span className="text-sm text-stone-200">{shell("primary.calendar")}</span>
            </div>
          </div>
        </div>
        <p className="text-xs leading-6 text-stone-500">{t("footer")}</p>
      </aside>

      <section className="flex min-h-svh flex-col">
        <header className="flex min-h-24 items-center justify-between gap-4 px-6 sm:px-10 lg:justify-end">
          <Link href="/" className="flex items-center gap-2 rounded-lg font-semibold outline-none focus-visible:ring-2 focus-visible:ring-ring lg:hidden">
            <span className="flex size-8 items-center justify-center rounded-lg bg-amber-300 text-stone-950"><ImageIcon className="size-4" aria-hidden="true" /></span>
            {shell("brandName")}
          </Link>
          <LanguageSwitcher />
        </header>
        <div className="flex flex-1 items-center justify-center px-6 pb-16 pt-6 sm:px-10">
          <div className="w-full max-w-sm">
            <div className="mb-8">
              <h1 className="text-3xl font-semibold leading-snug tracking-tight">{title}</h1>
              <p className="mt-3 text-sm leading-7 text-muted-foreground">{description}</p>
            </div>
            {children}
            <div className="mt-8 border-t pt-6 text-center text-sm text-muted-foreground">{footer}</div>
          </div>
        </div>
      </section>
    </main>
  );
}
