import { betterAuth } from "better-auth";
import { after } from "next/server";
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
import { getAuthServerBaseURL } from "@/lib/auth/origins";
import { getDb, isDatabaseConfigured, schema } from "@/lib/db";
import { changeEmailConfirmationEmail, getEmailSender, verificationEmail } from "@/lib/auth/email-sender";
import {
  getOnboardingAnalytics,
  recordOnboardingEventBestEffort,
} from "@/lib/onboarding/analytics";

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

function getConfiguredBaseUrl(): string | undefined {
  const configured =
    process.env.BETTER_AUTH_URL?.trim() ||
    process.env.NEXT_PUBLIC_APP_URL?.trim() ||
    process.env.NEXT_PUBLIC_BETTER_AUTH_URL?.trim();

  return configured;
}

function getTrustedOrigins(configuredBaseUrl: string | undefined): string[] {
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

  if (configuredBaseUrl) {
    configured.push(configuredBaseUrl);
  }
  return Array.from(new Set(configured));
}

const configuredBaseUrl = getConfiguredBaseUrl();
const baseUrl = getAuthServerBaseURL(
  configuredBaseUrl,
  isProductionLikeRuntime(),
);
const authSecret = getAuthSecret();
const authFeatureFlags = getAuthFeatureFlags();
const authFeatureWarnings = getAuthFeatureWarnings(authFeatureFlags);
const onboardingAnalytics = getOnboardingAnalytics();
for (const warning of authFeatureWarnings) {
  // Keep startup resilient for optional, staged features.
  console.warn(`[auth] ${warning}`);
}

const socialProviders = getSocialProviderConfig(authFeatureFlags);
const authPlugins = [
  nextCookies(),
  organization(),
  ...(authFeatureFlags.magicLink
    ? [
        magicLink({
          sendMagicLink: async ({ email, url }) => {
            console.info(`[auth] Magic link requested for ${email}: ${url}`);
          },
        }),
      ]
    : []),
  ...(authFeatureFlags.twoFactor ? [twoFactor()] : []),
];

export const auth = betterAuth({
  appName: "Node Banana",
  basePath: "/api/auth",
  baseURL: baseUrl,
  secret: authSecret,
  trustedOrigins: getTrustedOrigins(configuredBaseUrl),
  database: getAuthDatabase(),
  plugins: authPlugins,
  user: {
    changeEmail: {
      enabled: true,
      sendChangeEmailConfirmation: async ({ user, newEmail, url }) => {
        await getEmailSender().send(changeEmailConfirmationEmail({
          to: user.email,
          newEmail,
          confirmationUrl: url,
        }));
      },
    },
  },
  emailAndPassword: {
    enabled: true,
    requireEmailVerification: true,
    minPasswordLength: 8,
    maxPasswordLength: 128,
  },
  emailVerification: {
    sendVerificationEmail: async ({ user, url }) => {
      await getEmailSender().send(
        verificationEmail({
          to: user.email,
          verificationUrl: url,
        }),
      );
      await recordOnboardingEventBestEffort(onboardingAnalytics, {
        eventName: "verification_sent",
        userId: user.id,
        occurredAt: new Date(),
      });
    },
    sendOnSignUp: true,
    sendOnSignIn: true,
    autoSignInAfterVerification: true,
    afterEmailVerification: async (user) => {
      await recordOnboardingEventBestEffort(onboardingAnalytics, {
        eventName: "verification_completed",
        userId: user.id,
        occurredAt: new Date(),
      });
    },
  },
  databaseHooks: {
    user: {
      create: {
        after: async (user) => {
          await recordOnboardingEventBestEffort(onboardingAnalytics, {
            eventName: "signup_submitted",
            userId: user.id,
            occurredAt: new Date(),
          });
        },
      },
    },
  },
  advanced: {
    backgroundTasks: {
      handler: (promise) => {
        after(() => promise);
      },
    },
  },
  socialProviders,
});
