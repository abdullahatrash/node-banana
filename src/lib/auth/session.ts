import { auth } from "@/lib/auth/server";
import { isProductionLikeRuntime } from "@/lib/auth/features";

export type ServerAuthSession = Awaited<ReturnType<typeof auth.api.getSession>>;

export function parseHeaderValue(value: string | null): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

export function isDevAuthBypassEnabled(): boolean {
  if (process.env.DEV_AUTH_BYPASS !== "true") return false;
  return !isProductionLikeRuntime();
}

export function getDevFallbackUserId(): string {
  return process.env.DEV_USER_ID || "local-user";
}

export function getDevFallbackWorkspaceId(): string {
  return process.env.DEV_WORKSPACE_ID || "local-workspace";
}

export async function getServerAuthSession(headers: Headers): Promise<ServerAuthSession> {
  try {
    return await auth.api.getSession({ headers });
  } catch {
    return null;
  }
}

export async function getAuthenticatedUserFromHeaders(headers: Headers): Promise<{
  id: string;
  name: string | null;
  email: string | null;
} | null> {
  const session = await getServerAuthSession(headers);
  const userId = parseHeaderValue(session?.user?.id ?? null);
  if (!userId) return null;

  return {
    id: userId,
    name: parseHeaderValue(session?.user?.name ?? null),
    email: parseHeaderValue(session?.user?.email ?? null),
  };
}
