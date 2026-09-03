import Link from "next/link";
import { KeyRoundIcon, PlugZapIcon, XIcon } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { ApiTokensSettings } from "@/components/social/ApiTokensSettings";
import { ProviderKeysSettings } from "@/components/social/ProviderKeysSettings";
import { SettingsSheet } from "@/components/product-shell/SettingsSheet";

const sections = [
  { key: "api", icon: KeyRoundIcon },
  { key: "providers", icon: PlugZapIcon },
] as const;

type SettingsSection = (typeof sections)[number]["key"];

function readSection(value: string | string[] | undefined): SettingsSection {
  return value === "providers" ? "providers" : "api";
}

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ section?: string | string[] }>;
}) {
  const [{ section }, t] = await Promise.all([
    searchParams,
    getTranslations("shell.settings"),
  ]);
  const activeSection = readSection(section);

  return (
    <SettingsSheet>
      <section
        aria-labelledby="settings-title"
        className="flex min-h-0 flex-1 flex-col bg-background"
      >
        <header className="flex min-h-16 items-center gap-3 border-b px-4 sm:px-6">
          <div className="min-w-0 flex-1">
            <h2 id="settings-title" className="truncate text-lg font-semibold">
              {t("title")}
            </h2>
            <p
              id="settings-description"
              className="truncate text-xs text-muted-foreground"
            >
              {t("description")}
            </p>
          </div>
          <Link
            href="/dashboard"
            aria-label={t("close")}
            className="flex size-10 shrink-0 items-center justify-center rounded-md outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
          >
            <XIcon className="size-5" />
          </Link>
        </header>

        <details className="border-b px-4 py-3 md:hidden">
          <summary className="cursor-pointer rounded-md text-sm font-semibold outline-none focus-visible:ring-2 focus-visible:ring-ring">
            {t(`sections.${activeSection}`)}
          </summary>
          <nav aria-label={t("navigationLabel")} className="mt-3 grid gap-1">
            {sections.map(({ key, icon: Icon }) => (
              <Link
                key={key}
                href={`/settings?section=${key}`}
                aria-current={key === activeSection ? "page" : undefined}
                className="flex min-h-11 items-center gap-3 rounded-md px-3 text-sm hover:bg-muted aria-[current=page]:bg-muted aria-[current=page]:font-semibold"
              >
                <Icon className="size-4" />
                {t(`sections.${key}`)}
              </Link>
            ))}
          </nav>
        </details>

        <div className="flex min-h-0 flex-1">
          <aside className="hidden w-56 shrink-0 border-e p-4 md:block">
            <nav aria-label={t("navigationLabel")} className="grid gap-1">
              {sections.map(({ key, icon: Icon }) => (
                <Link
                  key={key}
                  href={`/settings?section=${key}`}
                  aria-current={key === activeSection ? "page" : undefined}
                  className="flex min-h-10 items-center gap-3 rounded-md px-3 text-sm outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring aria-[current=page]:bg-muted aria-[current=page]:font-semibold"
                >
                  <Icon className="size-4" />
                  {t(`sections.${key}`)}
                </Link>
              ))}
            </nav>
          </aside>
          <main className="min-w-0 flex-1 overflow-y-auto">
            {activeSection === "providers" ? (
              <ProviderKeysSettings />
            ) : (
              <ApiTokensSettings />
            )}
          </main>
        </div>
      </section>
    </SettingsSheet>
  );
}
