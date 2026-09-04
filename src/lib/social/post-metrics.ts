import type { PostMetricsResult, SocialPostMetricName } from "./provider-interface";

const POST_ID_PATTERN = /^[A-Za-z0-9._:-]{1,200}$/;

export function validatePostMetricIds(values: string[], maximum: number) {
  if (!Number.isInteger(maximum) || maximum < 1 || values.length < 1 || values.length > maximum) {
    throw new Error("SOCIAL_POST_METRICS_BATCH_INVALID");
  }
  const unique = [...new Set(values)];
  if (unique.length !== values.length || unique.some((value) => !POST_ID_PATTERN.test(value))) {
    throw new Error("SOCIAL_POST_METRICS_IDS_INVALID");
  }
  return unique;
}

export function parseProviderCount(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = typeof value === "number" ? value : typeof value === "string" && /^\d+$/.test(value) ? Number(value) : Number.NaN;
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new Error("SOCIAL_POST_METRIC_INVALID");
  return parsed;
}

export function normalizedMetrics(input: Partial<Record<SocialPostMetricName, unknown>>): PostMetricsResult["metrics"] {
  return {
    views: parseProviderCount(input.views),
    likes: parseProviderCount(input.likes),
    comments: parseProviderCount(input.comments),
    shares: parseProviderCount(input.shares),
  };
}

export function responseRequestId(response: { headers?: unknown }, names: string[]) {
  const headers = response.headers;
  for (const name of names) {
    let raw: unknown;
    if (headers && typeof headers === "object" && "get" in headers && typeof headers.get === "function") {
      raw = headers.get(name);
    } else if (headers && typeof headers === "object") {
      raw = (headers as Record<string, unknown>)[name] ?? (headers as Record<string, unknown>)[name.toLowerCase()];
    }
    const value = (Array.isArray(raw) ? raw[0] : raw)?.toString().trim();
    if (value) return value.slice(0, 200);
  }
  return null;
}
