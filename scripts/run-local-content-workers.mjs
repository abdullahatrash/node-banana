import nextEnv from "@next/env";

const { loadEnvConfig } = nextEnv;
loadEnvConfig(process.cwd());

const urlIndex = process.argv.indexOf("--url");
const baseUrl = new URL(urlIndex >= 0 ? process.argv[urlIndex + 1] : "http://localhost:3000");
if (!new Set(["localhost", "127.0.0.1", "::1"]).has(baseUrl.hostname) || !["http:", "https:"].includes(baseUrl.protocol)) {
  throw new Error("workers:local accepts loopback URLs only.");
}
const secret = process.env.STUDIO_INTERNAL_API_SECRET?.trim();
if (!secret) throw new Error("STUDIO_INTERNAL_API_SECRET is missing from the local environment.");

const routes = [
  ["performance", "/api/studio/internal/social-performance-sync?limit=20"],
  ["youtube-trends", "/api/studio/internal/youtube-trends?limit=20"],
  ["trends", "/api/studio/internal/inspiration-trends?limit=20"],
  ["licensed-trend-imports", "/api/studio/internal/licensed-trend-materialization?limit=10"],
  ["merchant-checkouts", "/api/studio/internal/reconcile-checkouts?limit=20"],
  ["merchant-adjustments", "/api/studio/internal/reconcile-merchant-adjustments?limit=20"],
  ["notification-projection", "/api/studio/internal/notification-projection?limit=50"],
  ["notification-email", "/api/studio/internal/notification-email?limit=20"],
];

for (const [label, pathname] of routes) {
  const response = await fetch(new URL(pathname, baseUrl), { headers: { "x-studio-internal-secret": secret } });
  const body = await response.text();
  if (!response.ok) throw new Error(`${label} worker failed with HTTP ${response.status}: ${body.slice(0, 500)}`);
  const parsed = JSON.parse(body);
  console.log(`${label}: ${JSON.stringify(parsed.summary ?? parsed)}`);
}

const attributionResponse = await fetch(new URL("/api/studio/internal/marketing-attribution?limit=20", baseUrl), { headers: { "x-studio-internal-secret": secret } });
const attributionBody = await attributionResponse.text();
if (!attributionResponse.ok) throw new Error(`x-ads-attribution worker failed with HTTP ${attributionResponse.status}: ${attributionBody.slice(0, 500)}`);
console.log(`x-ads-attribution: ${JSON.stringify(JSON.parse(attributionBody).result)}`);
