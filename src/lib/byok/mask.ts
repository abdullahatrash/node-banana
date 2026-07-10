/**
 * Non-secret display hint for a provider API key, e.g. `sk-…abc4`. This is
 * the ONLY form of a stored key any read path may return — the raw key is
 * write-only and decrypted solely for outbound provider calls
 * (see `resolveProviderKey` in `./repository`).
 */
const PREFIX_LENGTH = 3;
const SUFFIX_LENGTH = 4;
/** Below this length, showing prefix + suffix would reveal the whole key. */
const MIN_LENGTH_FOR_PARTIAL_MASK = PREFIX_LENGTH + SUFFIX_LENGTH + 2;

export function maskProviderKey(rawKey: string): string {
  if (rawKey.length < MIN_LENGTH_FOR_PARTIAL_MASK) {
    return "•".repeat(rawKey.length);
  }

  const prefix = rawKey.slice(0, PREFIX_LENGTH);
  const suffix = rawKey.slice(-SUFFIX_LENGTH);
  return `${prefix}…${suffix}`;
}
