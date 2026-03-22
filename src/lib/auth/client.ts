import { createAuthClient } from "better-auth/react";

const configuredBaseURL =
  process.env.NEXT_PUBLIC_BETTER_AUTH_URL?.trim() ||
  process.env.NEXT_PUBLIC_APP_URL?.trim();

export const authClient = createAuthClient(
  configuredBaseURL
    ? {
        baseURL: configuredBaseURL,
      }
    : {},
);
