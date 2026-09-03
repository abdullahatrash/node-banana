const SAFE_KEY = /^(count|attempt|durationMs|progress|providerFamily|modelFamily|region|language|arabicVariety|format|aspectRatio)$/;

export function redactOperationMetadata(value: Record<string, unknown>): Record<string, string | number | boolean | null> {
  return Object.fromEntries(Object.entries(value).flatMap(([key, item]) => {
    if (!SAFE_KEY.test(key)) return [];
    if (item === null || typeof item === "string" || typeof item === "number" || typeof item === "boolean") {
      return [[key, typeof item === "string" ? item.slice(0, 200) : item]];
    }
    return [];
  }));
}
