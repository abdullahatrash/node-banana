import { createAuthClient } from "better-auth/react";
import {
  magicLinkClient,
  organizationClient,
  twoFactorClient,
} from "better-auth/client/plugins";

const configuredBaseURL =
  process.env.NEXT_PUBLIC_BETTER_AUTH_URL?.trim() ||
  process.env.NEXT_PUBLIC_APP_URL?.trim();

function isTruthy(value: string | undefined): boolean {
  if (!value) return false;
  const normalized = value.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on";
}

const enabledMagicLink = isTruthy(process.env.NEXT_PUBLIC_BETTER_AUTH_ENABLE_MAGIC_LINK);
const enabledTwoFactor = isTruthy(process.env.NEXT_PUBLIC_BETTER_AUTH_ENABLE_TWO_FACTOR);

const clientPlugins: Array<
  | ReturnType<typeof organizationClient>
  | ReturnType<typeof magicLinkClient>
  | ReturnType<typeof twoFactorClient>
> = [organizationClient()];
if (enabledMagicLink) {
  clientPlugins.push(magicLinkClient());
}
if (enabledTwoFactor) {
  clientPlugins.push(twoFactorClient());
}

export const authClient = createAuthClient(
  {
    ...(configuredBaseURL ? { baseURL: configuredBaseURL } : {}),
    plugins: clientPlugins,
  },
);
