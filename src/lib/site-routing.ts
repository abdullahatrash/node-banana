const PRODUCT_PATH_PREFIXES = [
  "/agents",
  "/ai-studio",
  "/analytics",
  "/approvals",
  "/automations",
  "/billing",
  "/blitz",
  "/brand",
  "/calendar",
  "/channels",
  "/compose",
  "/content",
  "/dashboard",
  "/deliveries",
  "/editor",
  "/influencers",
  "/inspiration",
  "/library",
  "/onboarding",
  "/r",
  "/refer-and-earn",
  "/sign-in",
  "/sign-up",
  "/simple-studio",
  "/social",
  "/settings",
  "/studio",
  "/verify-email",
] as const;

type SiteSurface = "marketing" | "product" | "neutral";

export interface SiteRoutingInput {
  requestUrl: string;
  hostname: string;
  marketingOrigin: string | null;
  appOrigin: string | null;
}

export function normalizeOrigin(
  value: string | undefined | null,
): string | null {
  if (!value?.trim()) return null;

  try {
    const url = new URL(value.trim());
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url.origin;
  } catch {
    return null;
  }
}

export function isProductPath(pathname: string): boolean {
  return PRODUCT_PATH_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

function hostnameFor(origin: string | null): string | null {
  if (!origin) return null;
  return new URL(origin).hostname.toLowerCase();
}

function classifySurface(
  hostname: string,
  marketingOrigin: string | null,
  appOrigin: string | null,
): SiteSurface {
  const normalizedHostname = hostname.toLowerCase().replace(/\.$/, "");

  // Keep the default development URL convenient. Developers can opt into the
  // real split with app.localhost and www.localhost.
  if (normalizedHostname === "localhost" || normalizedHostname === "127.0.0.1") {
    return "neutral";
  }

  if (normalizedHostname === hostnameFor(appOrigin)) return "product";

  const marketingHostname = hostnameFor(marketingOrigin);
  if (
    normalizedHostname === marketingHostname ||
    (marketingHostname && normalizedHostname === `www.${marketingHostname}`) ||
    (marketingHostname?.startsWith("www.") &&
      normalizedHostname === marketingHostname.slice(4))
  ) {
    return "marketing";
  }

  if (normalizedHostname === "app.localhost") return "product";
  if (normalizedHostname === "www.localhost") return "marketing";

  return "neutral";
}

export function getSiteRedirect(input: SiteRoutingInput): string | null {
  const requestUrl = new URL(input.requestUrl);
  const surface = classifySurface(
    input.hostname,
    input.marketingOrigin,
    input.appOrigin,
  );

  if (surface === "marketing" && isProductPath(requestUrl.pathname)) {
    if (!input.appOrigin) return null;
    return new URL(
      `${requestUrl.pathname}${requestUrl.search}${requestUrl.hash}`,
      input.appOrigin,
    ).toString();
  }

  if (surface === "product" && requestUrl.pathname === "/") {
    return new URL(
      "/onboarding",
      input.appOrigin || requestUrl.origin,
    ).toString();
  }

  return null;
}

export function getPublicAppUrl(pathname = "/"): string {
  const appOrigin = normalizeOrigin(process.env.NEXT_PUBLIC_APP_URL);
  return appOrigin ? new URL(pathname, appOrigin).toString() : pathname;
}
