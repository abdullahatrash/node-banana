import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { memoryAdapter } from "better-auth/adapters/memory";
import { nextCookies } from "better-auth/next-js";
import { getDb, isDatabaseConfigured, schema } from "@/lib/db";
import { ensurePersonalWorkspaceForUser } from "@/lib/studio/repository";

const memoryDb = {
  user: [],
  session: [],
  account: [],
  verification: [],
};

function getAuthDatabase() {
  if (isDatabaseConfigured()) {
    return drizzleAdapter(getDb(), {
      provider: "pg",
      schema,
      usePlural: false,
    });
  }

  // Non-breaking fallback for local development when DATABASE_URL isn't set.
  // Existing AI studio features continue to work while infra is being configured.
  return memoryAdapter(memoryDb);
}

const DEV_SECRET_FALLBACK = "change-this-dev-secret-before-production";

function getAuthSecret(): string {
  const configured = process.env.BETTER_AUTH_SECRET?.trim();
  if (configured) {
    return configured;
  }

  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "BETTER_AUTH_SECRET must be set in non-development environments.",
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

  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "BETTER_AUTH_URL (or NEXT_PUBLIC_APP_URL) must be set in non-development environments.",
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

  if (process.env.NODE_ENV !== "production") {
    configured.push("http://localhost:3000", "http://127.0.0.1:3000");
  }

  configured.push(baseUrl);
  return Array.from(new Set(configured));
}

const baseUrl = getBaseUrl();
const authSecret = getAuthSecret();

export const auth = betterAuth({
  appName: "Node Banana",
  basePath: "/api/auth",
  baseURL: baseUrl,
  secret: authSecret,
  trustedOrigins: getTrustedOrigins(baseUrl),
  database: getAuthDatabase(),
  plugins: [nextCookies()],
  emailAndPassword: {
    enabled: true,
    requireEmailVerification: false,
  },
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
