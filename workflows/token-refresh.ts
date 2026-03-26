/**
 * Proactive token refresh workflow.
 *
 * Refreshes an expiring social account token before it expires.
 * Can be triggered by a cron job or before scheduled publishes.
 * If refresh fails, marks the account as requiresReauth so the
 * user is prompted to reconnect.
 */

import { FatalError } from "workflow";

export async function tokenRefreshWorkflow(accountId: string) {
  "use workflow";

  const result = await doRefresh(accountId);
  return result;
}

interface RefreshResult {
  accountId: string;
  refreshed: boolean;
  requiresReauth: boolean;
  newExpiresAt?: string;
}

async function doRefresh(accountId: string): Promise<RefreshResult> {
  "use step";

  const { getSocialAccountById, updateSocialAccountTokens, markRequiresReauth } =
    await import("@/lib/social/repository");
  const { decryptToken, encryptToken } = await import("@/lib/social/crypto");
  const { getProvider } = await import("@/lib/social/provider-registry");

  const account = await getSocialAccountById(accountId);

  // Skip if no refresh token (e.g., X has permanent tokens)
  if (!account.refreshTokenEncrypted) {
    return {
      accountId,
      refreshed: false,
      requiresReauth: false,
    };
  }

  const provider = getProvider(account.platform);

  try {
    const refreshToken = decryptToken(account.refreshTokenEncrypted);
    const refreshed = await provider.refreshToken(refreshToken);

    const newExpiresAt = refreshed.expiresIn
      ? new Date(Date.now() + refreshed.expiresIn * 1000)
      : undefined;

    await updateSocialAccountTokens(accountId, {
      accessTokenEncrypted: encryptToken(refreshed.accessToken),
      refreshTokenEncrypted: refreshed.refreshToken
        ? encryptToken(refreshed.refreshToken)
        : undefined,
      tokenExpiresAt: newExpiresAt,
    });

    return {
      accountId,
      refreshed: true,
      requiresReauth: false,
      newExpiresAt: newExpiresAt?.toISOString(),
    };
  } catch {
    // Refresh failed — mark account for re-authentication
    await markRequiresReauth(accountId);

    throw new FatalError(
      `Token refresh failed for account ${accountId}. User must reconnect.`,
    );
  }
}
