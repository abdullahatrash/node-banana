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

const trustedOrigin =
  process.env.BETTER_AUTH_URL || process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";

export const auth = betterAuth({
  appName: "Node Banana",
  basePath: "/api/auth",
  baseURL: trustedOrigin,
  secret: process.env.BETTER_AUTH_SECRET || "change-this-dev-secret-before-production",
  trustedOrigins: [trustedOrigin],
  database: getAuthDatabase(),
  plugins: [nextCookies()],
  emailAndPassword: {
    enabled: true,
    requireEmailVerification: false,
  },
});

