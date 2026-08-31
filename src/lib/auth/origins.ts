export interface DynamicAuthBaseURL {
  allowedHosts: string[];
  protocol: "auto";
  fallback?: string;
}

const LOCAL_AUTH_HOSTS = ["localhost:*", "127.0.0.1:*", "[::1]:*"];

function isLocalOrigin(value: string): boolean {
  try {
    const { hostname } = new URL(value);
    return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
  } catch {
    return false;
  }
}

export function getAuthClientBaseURL(
  configuredBaseURL: string | undefined,
  productionLike: boolean,
): string | undefined {
  if (!configuredBaseURL) return undefined;

  // In local development the auth routes live on the same Next.js origin. Omitting
  // baseURL lets a server started on any available port keep using that origin.
  if (!productionLike && isLocalOrigin(configuredBaseURL)) {
    return undefined;
  }

  return configuredBaseURL;
}

export function getAuthServerBaseURL(
  configuredBaseURL: string | undefined,
  productionLike: boolean,
): string | DynamicAuthBaseURL {
  if (productionLike) {
    if (!configuredBaseURL) {
      throw new Error(
        "BETTER_AUTH_URL (or NEXT_PUBLIC_APP_URL) must be set in production/staging environments.",
      );
    }

    return configuredBaseURL;
  }

  return {
    allowedHosts: [...LOCAL_AUTH_HOSTS],
    protocol: "auto",
    ...(configuredBaseURL ? { fallback: configuredBaseURL } : {}),
  };
}
