export interface OAuthProviderCredentials {
  clientId: string;
  clientSecret: string;
}

export interface AuthFeatureFlags {
  googleOAuth: boolean;
  githubOAuth: boolean;
  magicLink: boolean;
  twoFactor: boolean;
  passkey: boolean;
  samlSso: boolean;
}

export function isProductionLikeRuntime(): boolean {
  if (process.env.NODE_ENV === "production") return true;
  if (process.env.APP_ENV === "staging") return true;
  if (process.env.DEPLOY_ENV === "staging") return true;
  if (process.env.VERCEL_ENV === "preview") return true;
  return false;
}

function isTruthy(value: string | undefined): boolean {
  if (!value) return false;
  const normalized = value.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on";
}

export function getAuthFeatureFlags(): AuthFeatureFlags {
  return {
    googleOAuth: isTruthy(process.env.BETTER_AUTH_ENABLE_GOOGLE_OAUTH),
    githubOAuth: isTruthy(process.env.BETTER_AUTH_ENABLE_GITHUB_OAUTH),
    magicLink: isTruthy(process.env.BETTER_AUTH_ENABLE_MAGIC_LINK),
    twoFactor: isTruthy(process.env.BETTER_AUTH_ENABLE_TWO_FACTOR),
    passkey: isTruthy(process.env.BETTER_AUTH_ENABLE_PASSKEY),
    samlSso: isTruthy(process.env.BETTER_AUTH_ENABLE_SAML_SSO),
  };
}

function readOAuthCredentials(providerName: string): OAuthProviderCredentials | null {
  const upper = providerName.toUpperCase();
  const clientId = process.env[`BETTER_AUTH_${upper}_CLIENT_ID`]?.trim();
  const clientSecret = process.env[`BETTER_AUTH_${upper}_CLIENT_SECRET`]?.trim();

  if (!clientId && !clientSecret) return null;
  if (!clientId || !clientSecret) {
    throw new Error(
      `BETTER_AUTH_${upper}_CLIENT_ID and BETTER_AUTH_${upper}_CLIENT_SECRET must both be set when ${providerName} OAuth is enabled.`,
    );
  }

  return {
    clientId,
    clientSecret,
  };
}

export function getSocialProviderConfig(flags: AuthFeatureFlags): {
  google?: OAuthProviderCredentials;
  github?: OAuthProviderCredentials;
} {
  const socialProviders: {
    google?: OAuthProviderCredentials;
    github?: OAuthProviderCredentials;
  } = {};

  if (flags.googleOAuth) {
    const credentials = readOAuthCredentials("google");
    if (!credentials) {
      throw new Error(
        "Google OAuth is enabled but credentials are missing. Set BETTER_AUTH_GOOGLE_CLIENT_ID and BETTER_AUTH_GOOGLE_CLIENT_SECRET.",
      );
    }
    socialProviders.google = credentials;
  }

  if (flags.githubOAuth) {
    const credentials = readOAuthCredentials("github");
    if (!credentials) {
      throw new Error(
        "GitHub OAuth is enabled but credentials are missing. Set BETTER_AUTH_GITHUB_CLIENT_ID and BETTER_AUTH_GITHUB_CLIENT_SECRET.",
      );
    }
    socialProviders.github = credentials;
  }

  return socialProviders;
}

export function getAuthFeatureWarnings(flags: AuthFeatureFlags): string[] {
  const warnings: string[] = [];

  if (flags.passkey) {
    warnings.push(
      "BETTER_AUTH_ENABLE_PASSKEY is set, but passkey plugin is not available in the installed better-auth version; skipping passkey enablement.",
    );
  }

  if (flags.samlSso) {
    warnings.push(
      "BETTER_AUTH_ENABLE_SAML_SSO is set, but a SAML/SSO plugin is not available in the installed better-auth version; skipping SAML/SSO enablement.",
    );
  }

  return warnings;
}
