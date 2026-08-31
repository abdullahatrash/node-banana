export const LINKEDIN_AUTHOR_KIND_SETTING =
  "nodeBanana.runtime.linkedinAuthorKind" as const;

export type LinkedInAuthorKind = "person" | "organization";

/**
 * Connection-time evidence used by the runtime Publishing Plan validator.
 * This marker is server-owned: generic account settings updates must preserve
 * it, and legacy LinkedIn accounts without it are intentionally unusable until
 * they reconnect.
 */
export function withLinkedInAuthorKind(
  settings: Record<string, unknown> | null | undefined,
  kind: LinkedInAuthorKind,
): Record<string, unknown> {
  return {
    ...(settings ?? {}),
    [LINKEDIN_AUTHOR_KIND_SETTING]: kind,
  };
}

export function readLinkedInAuthorKind(
  settings: Record<string, unknown> | null | undefined,
): LinkedInAuthorKind | null {
  const value = settings?.[LINKEDIN_AUTHOR_KIND_SETTING];
  return value === "person" || value === "organization" ? value : null;
}

export function preserveLinkedInAuthorKind(
  current: Record<string, unknown> | null | undefined,
  replacement: Record<string, unknown> | null | undefined,
): Record<string, unknown> | null {
  const sanitized = replacement ? { ...replacement } : null;
  if (sanitized) delete sanitized[LINKEDIN_AUTHOR_KIND_SETTING];
  const kind = readLinkedInAuthorKind(current);
  if (!kind) return sanitized;
  return withLinkedInAuthorKind(sanitized, kind);
}
