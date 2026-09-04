import Link from "next/link";
import { ArchiveIcon, BellIcon, BriefcaseBusinessIcon, CircleUserRoundIcon, CreditCardIcon, FileClockIcon, Globe2Icon, HardDriveIcon, KeyRoundIcon, LanguagesIcon, PlugZapIcon, ScaleIcon, ShieldAlertIcon, ShieldCheckIcon, UsersIcon, WaypointsIcon, XIcon } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { ApiTokensSettings } from "@/components/social/ApiTokensSettings";
import { ProviderKeysSettings } from "@/components/social/ProviderKeysSettings";
import { SettingsSheet } from "@/components/product-shell/SettingsSheet";
import { GovernanceSettingsSurface, type GovernanceSettingsSection } from "@/components/governance/GovernanceSettingsSurface";
import { BillingSettings } from "@/components/commercial/BillingSettings";
import { WorkspacePreferencesSettings } from "@/components/product-shell/WorkspacePreferencesSettings";
import { WorkspaceLanguageSettings } from "@/components/product-shell/WorkspaceLanguageSettings";
import { WorkspaceNotificationSettings } from "@/components/product-shell/WorkspaceNotificationSettings";
import { AccountSettings } from "@/components/product-shell/AccountSettings";
import { WorkspaceStorageSettings } from "@/components/product-shell/WorkspaceStorageSettings";
import { getAuthFeatureFlags } from "@/lib/auth/features";
import { isAppLocale } from "@/i18n/config";
import { requireOnboardingComplete } from "@/lib/onboarding/server-access";
import { getWorkspaceCalendarPreferences } from "@/lib/product-surfaces/calendar-preferences";
import { getWorkspaceContentLanguage } from "@/lib/product-surfaces/workspace-language-preferences";
import { resolveWorkspaceMemberPermissions, type ContentOSPermission } from "@/lib/studio/authz";

const sections = [
  { key: "account", icon: CircleUserRoundIcon },
  { key: "members", icon: UsersIcon },
  { key: "roles", icon: ShieldCheckIcon },
  { key: "approval", icon: ScaleIcon },
  { key: "portfolios", icon: BriefcaseBusinessIcon },
  { key: "audit", icon: FileClockIcon },
  { key: "data", icon: ArchiveIcon },
  { key: "safety", icon: ShieldAlertIcon },
  { key: "bulk", icon: WaypointsIcon },
  { key: "portability", icon: ArchiveIcon },
  { key: "language", icon: LanguagesIcon },
  { key: "preferences", icon: Globe2Icon },
  { key: "notifications", icon: BellIcon },
  { key: "storage", icon: HardDriveIcon },
  { key: "billing", icon: CreditCardIcon },
  { key: "api", icon: KeyRoundIcon },
  { key: "providers", icon: PlugZapIcon },
] as const;

type SettingsSection = (typeof sections)[number]["key"];

function readSection(value: string | string[] | undefined): SettingsSection {
  const selected = Array.isArray(value) ? value[0] : value;
  return sections.some((section) => section.key === selected)
    ? (selected as SettingsSection)
    : "account";
}

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ section?: string | string[] }>;
}) {
  const [{ section }, t, access] = await Promise.all([
    searchParams,
    getTranslations("shell.settings"),
    requireOnboardingComplete("/settings"),
  ]);
  const workspaceId = access.aggregate?.session.workspaceId;
  const [permissions, preferences, contentLanguage] = workspaceId ? await Promise.all([
    resolveWorkspaceMemberPermissions({ workspaceId, userId: access.session.user.id }),
    getWorkspaceCalendarPreferences(workspaceId),
    getWorkspaceContentLanguage(workspaceId),
  ]) : [[] as ContentOSPermission[], null, null];
  const interfaceLocale = isAppLocale(access.aggregate?.interfaceLocale) ? access.aggregate.interfaceLocale : "ar";
  const canReadBilling = permissions.includes("product:billing:read");
  const canManageBilling = permissions.includes("product:billing:manage");
  const canPurchaseBilling = permissions.includes("product:billing:purchase");
  const canManageNotifications = permissions.includes("social:view");
  const canReadStorage = permissions.includes("assets:read");
  const authFeatures = getAuthFeatureFlags();
  const visibleSections = sections.filter(({ key }) => (key !== "billing" || canReadBilling) && (key !== "notifications" || canManageNotifications) && (key !== "storage" || canReadStorage));
  const requestedSection = readSection(section);
  const activeSection = (requestedSection === "billing" && !canReadBilling) || (requestedSection === "notifications" && !canManageNotifications) || (requestedSection === "storage" && !canReadStorage) ? "members" : requestedSection;

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
            {visibleSections.map(({ key, icon: Icon }) => (
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
              {visibleSections.map(({ key, icon: Icon }) => (
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
          <div className="min-w-0 flex-1 overflow-y-auto">
            {activeSection === "account" ? (
              <AccountSettings
                initialUser={{ name: access.session.user.name, email: access.session.user.email, emailVerified: access.session.user.emailVerified }}
                currentSessionId={access.session.session.id}
                enabledSocialProviders={[...(authFeatures.googleOAuth ? ["google" as const] : []), ...(authFeatures.githubOAuth ? ["github" as const] : [])]}
              />
            ) : activeSection === "billing" && workspaceId ? (
              <BillingSettings workspaceId={workspaceId} canManage={canManageBilling} canPurchase={canPurchaseBilling} />
            ) : activeSection === "language" && contentLanguage && workspaceId ? (
              <WorkspaceLanguageSettings workspaceId={workspaceId} initialInterfaceLocale={interfaceLocale} initialContentLanguage={contentLanguage} canManageContent={permissions.includes("product:content:write")} />
            ) : activeSection === "preferences" && preferences ? (
              <WorkspacePreferencesSettings initialPreferences={preferences} canManage={permissions.includes("social:publish")} />
            ) : activeSection === "notifications" && workspaceId && preferences ? (
              <WorkspaceNotificationSettings workspaceId={workspaceId} interfaceLocale={interfaceLocale} workspaceTimeZone={preferences.timezone} />
            ) : activeSection === "storage" && workspaceId ? (
              <WorkspaceStorageSettings workspaceId={workspaceId} />
            ) : activeSection === "providers" ? (
              <ProviderKeysSettings />
            ) : activeSection === "api" ? (
              <ApiTokensSettings />
            ) : (
              <GovernanceSettingsSurface section={activeSection as GovernanceSettingsSection} />
            )}
          </div>
        </div>
      </section>
    </SettingsSheet>
  );
}
