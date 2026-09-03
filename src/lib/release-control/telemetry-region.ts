const MENA_COUNTRIES = new Set(["AE", "BH", "DZ", "EG", "IQ", "IL", "JO", "KW", "LB", "LY", "MA", "OM", "PS", "QA", "SA", "SD", "SY", "TN", "YE"]);

export type TelemetryRegionClassification = "mena" | "non_mena" | "unknown";

export function classifyTelemetryRegion(headers: Headers, platform = process.env.VERCEL): TelemetryRegionClassification {
  if (platform !== "1") return "unknown";
  const country = headers.get("x-vercel-ip-country")?.trim().toUpperCase();
  if (!country || !/^[A-Z]{2}$/.test(country)) return "unknown";
  return MENA_COUNTRIES.has(country) ? "mena" : "non_mena";
}
