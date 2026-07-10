import { z } from "zod";

import { listSocialAccounts } from "@/lib/social/repository";

import type { ToolDefinition } from "../types";

const inputSchema = z.object({});

const socialAccountSchema = z.object({
  id: z.string(),
  platform: z.string(),
  platformUserId: z.string(),
  displayName: z.string(),
  username: z.string().nullable(),
  avatarUrl: z.string().nullable(),
  tokenExpiresAt: z.string().nullable(),
  requiresReauth: z.boolean(),
  disabled: z.boolean(),
  createdAt: z.string(),
});

const outputSchema = z.object({
  accounts: z.array(socialAccountSchema),
});

function toIso(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

/**
 * List the connected social accounts for the token's workspace. Encrypted
 * tokens/secrets are stripped here — only non-sensitive display and status
 * fields cross the tool boundary, so no surface can ever leak credentials.
 */
export const listSocialAccountsTool: ToolDefinition<
  typeof inputSchema,
  typeof outputSchema
> = {
  name: "list_social_accounts",
  description:
    "List the social accounts connected to this workspace, with platform, handle, and connection status. Use the returned ids to target posts.",
  requiredPermission: "social:view",
  inputSchema,
  outputSchema,
  handler: async (_input, ctx) => {
    const accounts = await listSocialAccounts(ctx.session.workspace.id);
    return {
      accounts: accounts.map((account) => ({
        id: account.id,
        platform: account.platform,
        platformUserId: account.platformUserId,
        displayName: account.displayName,
        username: account.username ?? null,
        avatarUrl: account.avatarUrl ?? null,
        tokenExpiresAt: toIso(account.tokenExpiresAt),
        requiresReauth: account.requiresReauth,
        disabled: account.disabled,
        createdAt: toIso(account.createdAt) as string,
      })),
    };
  },
};
