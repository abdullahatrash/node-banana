"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { usePathname } from "next/navigation";
import {
  ActivityIcon,
  BarChart3Icon,
  BotIcon,
  BoxesIcon,
  CalendarDaysIcon,
  CheckCheckIcon,
  CircleGaugeIcon,
  CoinsIcon,
  FileCheck2Icon,
  FileTextIcon,
  FingerprintIcon,
  GaugeIcon,
  ImageIcon,
  KeyRoundIcon,
  LibraryIcon,
  LightbulbIcon,
  ListChecksIcon,
  PaletteIcon,
  PenSquareIcon,
  PlaySquareIcon,
  SendIcon,
  SettingsIcon,
  SparklesIcon,
  UsersRoundIcon,
  WandSparklesIcon,
  BookmarkIcon,
  BellIcon,
  CableIcon,
  PlugIcon,
} from "lucide-react";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { NavUser } from "@/components/nav-user";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarSeparator,
  SidebarTrigger,
  useSidebar,
} from "@/components/ui/sidebar";
import {
  findNavigationItem,
  additionalToolsNavigation,
  isNavigationItemActive,
  operationsNavigation,
  primaryNavigation,
  publishingNavigation,
  workspaceNavigation,
  type ContextNavigationKey,
  type NavigationItem,
  type PrimaryNavigationKey,
} from "@/lib/navigation/app-navigation";
import type { ProductShellContext } from "@/lib/product-shell/server";
import { WorkspaceSwitcher } from "./WorkspaceSwitcher";

const primaryIcons = {
  dashboard: CircleGaugeIcon,
  blitz: WandSparklesIcon,
  inspiration: LightbulbIcon,
  automations: SparklesIcon,
  aiStudio: PaletteIcon,
  influencers: UsersRoundIcon,
  content: FileTextIcon,
  library: LibraryIcon,
  calendar: CalendarDaysIcon,
  analytics: BarChart3Icon,
  brand: FingerprintIcon,
  settings: SettingsIcon,
} satisfies Record<PrimaryNavigationKey, typeof ActivityIcon>;

const contextIcons = {
  compose: PenSquareIcon,
  channels: SendIcon,
  approvals: CheckCheckIcon,
  deliveries: FileCheck2Icon,
  agents: BotIcon,
  videoEditor: PlaySquareIcon,
  usage: GaugeIcon,
  budgets: CoinsIcon,
  quotas: ListChecksIcon,
  credentials: KeyRoundIcon,
  observability: ActivityIcon,
  operations: CircleGaugeIcon,
  modelRouting: WandSparklesIcon,
  promptLibrary: BookmarkIcon,
  posts: BoxesIcon,
  socialMedia: ImageIcon,
  events: BellIcon,
  copilot: SparklesIcon,
  integrations: CableIcon,
  plugs: PlugIcon,
} satisfies Record<ContextNavigationKey, typeof ActivityIcon>;

function ShellLink({
  item,
  label,
  icon: Icon,
}: {
  item: NavigationItem;
  label: string;
  icon: typeof ActivityIcon;
}) {
  const pathname = usePathname() || "/";
  const { isMobile, setOpenMobile } = useSidebar();
  const active = isNavigationItemActive(pathname, item);
  const current = findNavigationItem(pathname)?.key === item.key;

  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        isActive={active}
        tooltip={label}
        render={
          <Link
            href={item.href}
            aria-current={current ? "page" : undefined}
            onClick={() => {
              if (isMobile) setOpenMobile(false);
            }}
          />
        }
      >
        <Icon />
        <span>{label}</span>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}

export function ProductShell({
  children,
  context,
  headerActions,
}: {
  children: ReactNode;
  context: ProductShellContext;
  headerActions?: ReactNode;
}) {
  const locale = useLocale();
  const t = useTranslations("shell");
  const pathname = usePathname() || "/dashboard";
  const currentItem = findNavigationItem(pathname);
  const title = currentItem
    ? "key" in currentItem && primaryNavigation.some((item) => item.key === currentItem.key)
      ? t(`primary.${currentItem.key as PrimaryNavigationKey}`)
      : t(`context.${currentItem.key as ContextNavigationKey}`)
    : t("brandName");
  const side = locale === "ar" ? "right" : "left";

  return (
    <SidebarProvider
      style={
        {
          "--sidebar-width": "17rem",
          "--header-height": "3.5rem",
        } as React.CSSProperties
      }
    >
      <Link
        href="#product-main-content"
        className="fixed start-3 top-3 z-50 -translate-y-20 rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground focus:translate-y-0"
      >
        {t("skipToContent")}
      </Link>
      <Sidebar
        side={side}
        variant="inset"
        collapsible="icon"
        dir={locale === "ar" ? "rtl" : "ltr"}
        mobileTitle={t("sidebar.title")}
        mobileDescription={t("sidebar.description")}
      >
        <SidebarHeader>
          <Link
            href="/dashboard"
            className="flex min-h-10 items-center gap-2 rounded-lg px-2 text-sm font-bold outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <span className="flex size-8 items-center justify-center rounded-lg bg-amber-300 text-stone-950">
              <ImageIcon className="size-4" />
            </span>
            <span className="truncate text-base">{t("brandName")}</span>
          </Link>
          <WorkspaceSwitcher
            workspaces={context.workspaces}
            initialWorkspaceId={context.initialWorkspaceId}
          />
        </SidebarHeader>
        <SidebarContent>
          <nav aria-label={t("navigationLabel")}>
            <SidebarGroup>
              <SidebarGroupContent>
                <SidebarMenu>
                  {primaryNavigation.map((item) => {
                    const Icon = primaryIcons[item.key];
                    const label = t(`primary.${item.key}`);
                    if (!("href" in item)) {
                      return (
                        <SidebarMenuItem key={item.key}>
                          <SidebarMenuButton
                            disabled
                            aria-disabled="true"
                            title={t("status.plannedDetail")}
                          >
                            <Icon />
                            <span>{label}</span>
                            <span className="ms-auto text-[10px] text-muted-foreground">
                              {t("status.planned")}
                            </span>
                          </SidebarMenuButton>
                        </SidebarMenuItem>
                      );
                    }
                    return (
                      <ShellLink key={item.key} item={item} label={label} icon={Icon} />
                    );
                  })}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
            <SidebarSeparator />
            <SidebarGroup>
              <SidebarGroupLabel>{t("groups.channels")}</SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu>
                  {publishingNavigation.map((item) => (
                    <ShellLink
                      key={item.key}
                      item={item}
                      label={t(`context.${item.key}`)}
                      icon={contextIcons[item.key]}
                    />
                  ))}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
            <SidebarGroup>
              <SidebarGroupLabel>{t("groups.workspace")}</SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu>
                  {workspaceNavigation.map((item) => (
                    <ShellLink
                      key={item.key}
                      item={item}
                      label={t(`context.${item.key}`)}
                      icon={contextIcons[item.key]}
                    />
                  ))}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
            <SidebarGroup>
              <SidebarGroupLabel>{t("groups.operations")}</SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu>
                  {operationsNavigation.map((item) => (
                    <ShellLink
                      key={item.key}
                      item={item}
                      label={t(`context.${item.key}`)}
                      icon={contextIcons[item.key]}
                    />
                  ))}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
            <SidebarGroup>
              <SidebarGroupLabel>{t("groups.more")}</SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu>
                  {additionalToolsNavigation.map((item) => (
                    <ShellLink
                      key={item.key}
                      item={item}
                      label={t(`context.${item.key}`)}
                      icon={contextIcons[item.key]}
                    />
                  ))}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          </nav>
        </SidebarContent>
        <SidebarFooter>
          <LanguageSwitcher className="w-full justify-start group-data-[collapsible=icon]:px-2" />
          <NavUser user={context.user} />
        </SidebarFooter>
      </Sidebar>
      <SidebarInset>
        <header className="flex h-(--header-height) shrink-0 items-center gap-2 border-b px-4 lg:px-6">
          <SidebarTrigger label={t("sidebar.toggle")} className="-ms-1" />
          <span className="h-4 w-px bg-border" aria-hidden="true" />
          <h1 className="min-w-0 truncate text-base font-semibold">{title}</h1>
          <div className="ms-auto flex min-w-0 items-center gap-2">{headerActions}</div>
        </header>
        <div id="product-main-content" tabIndex={-1} className="flex min-h-0 flex-1 flex-col">
          {children}
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}
