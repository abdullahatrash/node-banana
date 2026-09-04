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
  ["trends", "/api/studio/internal/inspiration-trends?limit=20"],
];

for (const [label, pathname] of routes) {
  const response = await fetch(new URL(pathname, baseUrl), { headers: { "x-studio-internal-secret": secret } });
  const body = await response.text();
  if (!response.ok) throw new Error(`${label} worker failed with HTTP ${response.status}: ${body.slice(0, 500)}`);
  const parsed = JSON.parse(body);
  console.log(`${label}: ${JSON.stringify(parsed.summary ?? parsed)}`);
}
