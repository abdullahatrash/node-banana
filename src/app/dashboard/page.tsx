import Link from "next/link";
import { CheckCheckIcon, PaletteIcon, SendIcon } from "lucide-react";
import { getTranslations } from "next-intl/server";

const dashboardActions = [
  {
    key: "create",
    href: "/ai-studio",
    icon: PaletteIcon,
  },
  {
    key: "publish",
    href: "/calendar",
    icon: SendIcon,
  },
  {
    key: "operate",
    href: "/approvals",
    icon: CheckCheckIcon,
  },
] as const;

export default async function DashboardPage() {
  const t = await getTranslations("shell.dashboard");

  return (
    <main className="flex flex-1 flex-col px-5 py-8 sm:px-8 lg:px-12 lg:py-12">
      <div className="mx-auto w-full max-w-6xl">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-amber-600">
          {t("eyebrow")}
        </p>
        <h2 className="mt-3 max-w-3xl text-3xl font-semibold tracking-tight sm:text-5xl">
          {t("title")}
        </h2>
        <p className="mt-5 max-w-2xl text-base leading-7 text-muted-foreground">
          {t("description")}
        </p>
        <div className="mt-10 grid gap-4 md:grid-cols-3">
          {dashboardActions.map((action) => (
            <Link
              key={action.key}
              href={action.href}
              className="group rounded-2xl border bg-card p-5 outline-none transition hover:border-amber-500/50 hover:shadow-sm focus-visible:ring-2 focus-visible:ring-ring"
            >
              <span className="flex size-10 items-center justify-center rounded-xl bg-amber-300 text-stone-950">
                <action.icon className="size-5" />
              </span>
              <h3 className="mt-5 text-lg font-semibold">{t(`${action.key}Title`)}</h3>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">
                {t(`${action.key}Description`)}
              </p>
              <span className="mt-5 inline-flex text-sm font-semibold text-amber-700 group-hover:text-amber-600">
                {t("open")}
              </span>
            </Link>
          ))}
        </div>
      </div>
    </main>
  );
}
