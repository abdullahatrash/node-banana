export type PrimaryNavigationKey =
  | "dashboard"
  | "blitz"
  | "inspiration"
  | "automations"
  | "aiStudio"
  | "influencers"
  | "content"
  | "library"
  | "calendar"
  | "analytics"
  | "billing"
  | "brand"
  | "settings";

export type ContextNavigationKey =
  | "compose"
  | "channels"
  | "approvals"
  | "deliveries"
  | "agents"
  | "videoEditor"
  | "usage"
  | "budgets"
  | "quotas"
  | "credentials"
  | "observability"
  | "operations"
  | "modelRouting"
  | "releaseQuality"
  | "promptLibrary"
  | "posts"
  | "socialMedia"
  | "events"
  | "copilot"
  | "integrations"
  | "plugs"
  | "guide"
  | "feedback"
  | "roadmap"
  | "releases"
  | "support";

export interface NavigationItem<Key extends string = string> {
  key: Key;
  href: string;
  aliases: readonly string[];
}

export interface PlannedNavigationItem<Key extends string = string> {
  key: Key;
  futureHref: string;
  availability: "planned";
}

export const primaryNavigation = [
  { key: "dashboard", href: "/dashboard", aliases: [] },
  { key: "blitz", href: "/blitz", aliases: [] },
  { key: "inspiration", href: "/inspiration", aliases: [] },
  {
    key: "automations",
    href: "/automations",
    aliases: ["/social/agents"],
  },
  {
    key: "aiStudio",
    href: "/ai-studio",
    aliases: [
      "/simple-studio/images",
      "/simple-studio/videos",
    ],
  },
  { key: "influencers", href: "/influencers", aliases: [] },
  {
    key: "content",
    href: "/content",
    aliases: ["/simple-studio/copy", "/social/posts"],
  },
  {
    key: "library",
    href: "/library",
    aliases: ["/simple-studio/library", "/social/media"],
  },
  { key: "calendar", href: "/calendar", aliases: ["/social/calendar"] },
  { key: "analytics", href: "/analytics", aliases: ["/social/analytics"] },
  { key: "billing", href: "/billing", aliases: [] },
  { key: "brand", href: "/brand", aliases: [] },
  { key: "settings", href: "/settings", aliases: ["/social/settings"] },
] as const satisfies readonly (
  | NavigationItem<PrimaryNavigationKey>
  | PlannedNavigationItem<PrimaryNavigationKey>
)[];

export const publishingNavigation = [
  { key: "compose", href: "/compose", aliases: ["/social/compose"] },
  { key: "channels", href: "/channels", aliases: ["/social/channels"] },
  {
    key: "approvals",
    href: "/approvals",
    aliases: ["/studio/publishing-approvals"],
  },
  {
    key: "deliveries",
    href: "/deliveries",
    aliases: ["/studio/publishing-deliveries"],
  },
] as const satisfies readonly NavigationItem<ContextNavigationKey>[];

export const workspaceNavigation = [
  { key: "agents", href: "/agents", aliases: [] },
  { key: "videoEditor", href: "/editor/projects", aliases: ["/editor"] },
] as const satisfies readonly NavigationItem<ContextNavigationKey>[];

export const operationsNavigation = [
  { key: "operations", href: "/studio/operations", aliases: [] },
  { key: "modelRouting", href: "/studio/model-routing", aliases: [] },
  { key: "releaseQuality", href: "/studio/release-quality", aliases: [] },
  { key: "usage", href: "/studio/usage", aliases: [] },
  { key: "budgets", href: "/studio/budgets", aliases: [] },
  { key: "quotas", href: "/studio/quotas", aliases: [] },
  { key: "credentials", href: "/studio/credentials", aliases: [] },
  { key: "observability", href: "/studio/observability", aliases: [] },
] as const satisfies readonly NavigationItem<ContextNavigationKey>[];

export const additionalToolsNavigation = [
  {
    key: "promptLibrary",
    href: "/simple-studio/prompt-library",
    aliases: [],
  },
  { key: "posts", href: "/social/posts", aliases: [] },
  { key: "socialMedia", href: "/social/media", aliases: [] },
  { key: "events", href: "/social/events", aliases: [] },
  { key: "copilot", href: "/social/copilot", aliases: [] },
  { key: "integrations", href: "/social/integrations", aliases: [] },
  { key: "plugs", href: "/social/plugs", aliases: [] },
  { key: "guide", href: "/guide", aliases: [] },
  { key: "feedback", href: "/feedback", aliases: [] },
  { key: "roadmap", href: "/roadmap", aliases: [] },
  { key: "releases", href: "/releases", aliases: [] },
  { key: "support", href: "/support", aliases: [] },
] as const satisfies readonly NavigationItem<ContextNavigationKey>[];

export const allNavigationItems = [
  ...primaryNavigation.filter(
    (item): item is Extract<(typeof primaryNavigation)[number], { href: string }> =>
      "href" in item,
  ),
  ...publishingNavigation,
  ...workspaceNavigation,
  ...operationsNavigation,
  ...additionalToolsNavigation,
] as const;

function pathMatches(pathname: string, candidate: string): boolean {
  return pathname === candidate || pathname.startsWith(`${candidate}/`);
}

export function isNavigationItemActive(
  pathname: string,
  item: NavigationItem,
): boolean {
  return [item.href, ...item.aliases].some((path) =>
    pathMatches(pathname, path),
  );
}

export function findNavigationItem(pathname: string): NavigationItem | null {
  const directMatch = allNavigationItems.find((item) =>
    pathMatches(pathname, item.href),
  );
  if (directMatch) return directMatch;

  return (
    allNavigationItems.find((item) =>
      item.aliases.some((alias) => pathMatches(pathname, alias)),
    ) ??
    null
  );
}
