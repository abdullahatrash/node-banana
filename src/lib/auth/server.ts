import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { memoryAdapter } from "better-auth/adapters/memory";
import { nextCookies } from "better-auth/next-js";
import { getDb, isDatabaseConfigured, schema } from "@/lib/db";

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

function getTrustedOrigin(): string {
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

const trustedOrigin = getTrustedOrigin();
const authSecret = getAuthSecret();

export const auth = betterAuth({
  appName: "Node Banana",
  basePath: "/api/auth",
  baseURL: trustedOrigin,
  secret: authSecret,
  trustedOrigins: [trustedOrigin],
  database: getAuthDatabase(),
  plugins: [nextCookies()],
  emailAndPassword: {
    enabled: true,
    requireEmailVerification: false,
  },
});
