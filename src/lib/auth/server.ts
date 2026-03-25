import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { memoryAdapter } from "better-auth/adapters/memory";
import { nextCookies } from "better-auth/next-js";
import { magicLink } from "better-auth/plugins/magic-link";
import { organization } from "better-auth/plugins/organization";
import { twoFactor } from "better-auth/plugins/two-factor";
import {
  getAuthFeatureFlags,
  getAuthFeatureWarnings,
  getSocialProviderConfig,
  isProductionLikeRuntime,
} from "@/lib/auth/features";
import { getDb, isDatabaseConfigured, schema } from "@/lib/db";
import { ensurePersonalWorkspaceForUser } from "@/lib/studio/repository";

const memoryDb = {
  user: [],
  session: [],
  account: [],
  verification: [],
  organization: [],
  member: [],
  invitation: [],
};

function getAuthDatabase() {
  if (isDatabaseConfigured()) {
    return drizzleAdapter(getDb(), {
      provider: "pg",
      schema,
      usePlural: false,
    });
  }

  if (isProductionLikeRuntime()) {
    throw new Error(
      "DATABASE_URL must be set in production/staging environments for Postgres-backed Better Auth sessions.",
    );
  }

  // Local-only fallback for environments that are not production-like.
  return memoryAdapter(memoryDb);
}

const DEV_SECRET_FALLBACK = "change-this-dev-secret-before-production";

function getAuthSecret(): string {
  const configured = process.env.BETTER_AUTH_SECRET?.trim();
  if (configured) {
    return configured;
  }

  if (isProductionLikeRuntime()) {
    throw new Error(
      "BETTER_AUTH_SECRET must be set in production/staging environments.",
    );
  }

  return DEV_SECRET_FALLBACK;
}

function getBaseUrl(): string {
  const configured =
    process.env.BETTER_AUTH_URL?.trim() ||
    process.env.NEXT_PUBLIC_APP_URL?.trim() ||
    process.env.NEXT_PUBLIC_BETTER_AUTH_URL?.trim();

  if (configured) {
    return configured;
  }

  if (isProductionLikeRuntime()) {
    throw new Error(
      "BETTER_AUTH_URL (or NEXT_PUBLIC_APP_URL) must be set in production/staging environments.",
    );
  }

  return "http://localhost:3000";
}

function getTrustedOrigins(baseUrl: string): string[] {
  const configured = [
    process.env.BETTER_AUTH_URL,
    process.env.NEXT_PUBLIC_APP_URL,
    process.env.NEXT_PUBLIC_BETTER_AUTH_URL,
    ...(process.env.BETTER_AUTH_TRUSTED_ORIGINS || "")
      .split(",")
      .map((origin) => origin.trim())
      .filter(Boolean),
  ]
    .map((origin) => origin?.trim())
    .filter((origin): origin is string => Boolean(origin));

  if (!isProductionLikeRuntime()) {
    configured.push("http://localhost:3000", "http://127.0.0.1:3000");
  }

  configured.push(baseUrl);
  return Array.from(new Set(configured));
}

const baseUrl = getBaseUrl();
const authSecret = getAuthSecret();
const authFeatureFlags = getAuthFeatureFlags();
const authFeatureWarnings = getAuthFeatureWarnings(authFeatureFlags);
for (const warning of authFeatureWarnings) {
  // Keep startup resilient for optional, staged features.
  console.warn(`[auth] ${warning}`);
}

const socialProviders = getSocialProviderConfig(authFeatureFlags);
const authPlugins: Array<
  | ReturnType<typeof nextCookies>
  | ReturnType<typeof organization>
  | ReturnType<typeof magicLink>
  | ReturnType<typeof twoFactor>
> = [nextCookies(), organization()];

if (authFeatureFlags.magicLink) {
  authPlugins.push(
    magicLink({
      sendMagicLink: async ({ email, url }) => {
        console.info(`[auth] Magic link requested for ${email}: ${url}`);
      },
    }),
  );
}

if (authFeatureFlags.twoFactor) {
  authPlugins.push(twoFactor());
}

export const auth = betterAuth({
  appName: "Node Banana",
  basePath: "/api/auth",
  baseURL: baseUrl,
  secret: authSecret,
  trustedOrigins: getTrustedOrigins(baseUrl),
  database: getAuthDatabase(),
  plugins: authPlugins,
  emailAndPassword: {
    enabled: true,
    requireEmailVerification: false,
  },
  socialProviders,
  databaseHooks: {
    user: {
      create: {
        after: async (createdUser) => {
          // Only provision workspace when Postgres is enabled.
          if (!isDatabaseConfigured()) return;

          await ensurePersonalWorkspaceForUser({
            userId: createdUser.id,
            userName: createdUser.name ?? null,
            userEmail: createdUser.email ?? null,
          });
        },
      },
    },
  },
});
