const PLACEHOLDER_VALUES = new Set([
  "change-me",
  "change_me",
  "changeme",
  "placeholder",
  "replace-me",
  "replace_me",
]);

/** Returns a trimmed secret only when it is not an example-file placeholder. */
export function readConfiguredSecret(value: string | null | undefined): string | null {
  const candidate = value?.trim();
  if (!candidate) return null;
  const normalized = candidate.toLowerCase();
  if (PLACEHOLDER_VALUES.has(normalized)) return null;
  if (/^<[^>]+>$/.test(candidate) || /^\$\{[^}]+}$/.test(candidate)) return null;
  if (/^your[-_].*(?:key|token|secret|password)(?:[-_]here)?$/i.test(candidate)) return null;
  return candidate;
}

export function hasConfiguredSecret(value: string | null | undefined): boolean {
  return readConfiguredSecret(value) !== null;
}
