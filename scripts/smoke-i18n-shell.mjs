import nextEnv from "@next/env";
import arMessages from "../src/i18n/messages/ar.json" with { type: "json" };
import enMessages from "../src/i18n/messages/en.json" with { type: "json" };

nextEnv.loadEnvConfig(process.cwd());

const baseUrl = new URL(process.env.APP_BASE_URL || "http://localhost:3002");
if (!new Set(["localhost", "127.0.0.1", "::1"]).has(baseUrl.hostname)) {
  throw new Error("The interface-locale smoke accepts loopback URLs only.");
}

const routes = [
  ["/dashboard", "dashboard"],
  ["/blitz", "blitz"],
  ["/inspiration", "inspiration"],
  ["/automations", "automations"],
  ["/ai-studio", "aiStudio"],
  ["/influencers", "influencers"],
  ["/content", "content"],
  ["/library", "library"],
  ["/calendar", "calendar"],
  ["/analytics", "analytics"],
  ["/billing", "billing"],
  ["/brand", "brand"],
  ["/settings", "settings"],
];
const messages = { ar: arMessages, en: enMessages };
const cookieJar = new Map();
let workspaceId = "";
let originalLocale = "ar";

function escapeHtmlText(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function captureCookies(response) {
  const setCookies = typeof response.headers.getSetCookie === "function"
    ? response.headers.getSetCookie()
    : [response.headers.get("set-cookie")].filter(Boolean);
  for (const value of setCookies) {
    const pair = value.split(";", 1)[0];
    const separator = pair.indexOf("=");
    if (separator > 0) cookieJar.set(pair.slice(0, separator), pair.slice(separator + 1));
  }
}

function cookieHeader() {
  return [...cookieJar].map(([name, value]) => `${name}=${value}`).join("; ");
}

async function request(path, init = {}) {
  const response = await fetch(new URL(path, baseUrl), {
    ...init,
    headers: { cookie: cookieHeader(), ...(init.headers || {}) },
    redirect: init.redirect || "manual",
  });
  captureCookies(response);
  return response;
}

async function setLocale(locale) {
  const response = await request("/api/preferences/locale", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: baseUrl.origin,
      "x-workspace-id": workspaceId,
    },
    body: JSON.stringify({ locale }),
  });
  if (!response.ok) throw new Error(`Locale ${locale} persistence returned HTTP ${response.status}.`);
}

async function verifyRoute(locale, direction, [path, key]) {
  let response = await request(path, { headers: { "x-workspace-id": workspaceId } });
  for (let redirect = 0; redirect < 3 && response.status >= 300 && response.status < 400; redirect += 1) {
    const location = response.headers.get("location");
    if (!location) break;
    const destination = new URL(location, baseUrl);
    if (destination.origin !== baseUrl.origin) throw new Error(`${locale} ${path} redirected outside the local app.`);
    response = await request(`${destination.pathname}${destination.search}`, { headers: { "x-workspace-id": workspaceId } });
  }
  if (response.status !== 200) throw new Error(`${locale} ${path} returned HTTP ${response.status}.`);
  const html = await response.text();
  const htmlTag = html.match(/<html\b[^>]*>/i)?.[0] || "";
  if (!new RegExp(`\\blang=["']${locale}["']`).test(htmlTag) || !new RegExp(`\\bdir=["']${direction}["']`).test(htmlTag)) {
    throw new Error(`${locale} ${path} did not render the expected ${direction} document root.`);
  }
  const expectedTitle = messages[locale].shell.primary[key];
  if (!html.includes(expectedTitle) && !html.includes(escapeHtmlText(expectedTitle))) {
    const renderedTitle = html.match(/<h1\b[^>]*>(.*?)<\/h1>/is)?.[1]?.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim() || "missing";
    throw new Error(`${locale} ${path} did not render its authored shell title (found: ${renderedTitle}).`);
  }
  if (/MISSING_MESSAGE|IntlError|LOCALIZATION_MESSAGE_FAILURE/.test(html)) throw new Error(`${locale} ${path} exposed a localization failure marker.`);
}

try {
  const signIn = await request("/api/auth/sign-in/email", {
    method: "POST",
    headers: { "content-type": "application/json", origin: baseUrl.origin },
    body: JSON.stringify({
      email: process.env.SMOKE_EMAIL || "alice@nodebanana.dev",
      password: process.env.SMOKE_PASSWORD || "Password123!",
    }),
  });
  if (!signIn.ok || !cookieHeader()) throw new Error("Seeded-user sign-in failed.");
  await signIn.arrayBuffer();

  const workspaceResponse = await request("/api/studio/workspaces");
  const workspaceBody = await workspaceResponse.json();
  workspaceId = workspaceBody.workspaces?.[0]?.id || "";
  if (!workspaceResponse.ok || !workspaceId) throw new Error("No seeded Workspace is available.");

  const initialPage = await request("/dashboard", { headers: { "x-workspace-id": workspaceId } });
  const initialHtml = await initialPage.text();
  originalLocale = /<html\b[^>]*\blang=["']en["']/i.test(initialHtml) ? "en" : "ar";

  for (const [locale, direction] of [["ar", "rtl"], ["en", "ltr"]]) {
    await setLocale(locale);
    // Keep this sequential so a cold Turbopack dev server is not asked to
    // compile twelve authenticated route trees concurrently.
    for (const route of routes) await verifyRoute(locale, direction, route);
    const pricing = await request(`/${locale}/pricing`);
    if (pricing.status !== 200) throw new Error(`${locale} pricing returned HTTP ${pricing.status}.`);
    const pricingHtml = await pricing.text();
    if (!pricingHtml.includes(messages[locale].pricing.title)) throw new Error(`${locale} pricing did not render authored copy.`);
  }

  console.log(`[OK] Arabic RTL + English LTR shell matrix (${routes.length} authenticated routes + pricing)`);
} finally {
  if (workspaceId) {
    try { await setLocale(originalLocale); }
    catch (error) { console.warn(`[WARN] Could not restore the original locale: ${error instanceof Error ? error.message : "unknown"}`); }
  }
}
