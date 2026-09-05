import { spawn } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import nextEnv from "@next/env";

import { terminateChild } from "./child-process-cleanup.mjs";

nextEnv.loadEnvConfig(process.cwd());

const baseUrl = new URL(process.env.APP_BASE_URL || "http://localhost:3002");
if (!["localhost", "127.0.0.1", "::1"].includes(baseUrl.hostname)) throw new Error("The visual RTL smoke accepts loopback URLs only.");

const chromeBinary = process.env.CHROME_BIN || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const settingsSections = [
  "members", "roles", "approval", "portfolios", "audit", "data", "safety", "bulk", "portability",
  "language", "preferences", "notifications", "channels", "demoVideos", "remix", "privacy", "storage",
  "billing", "api", "providers",
];
const defaultRoutes = [
  "/dashboard",
  "/inspiration",
  "/blitz",
  "/simple-studio/images",
  "/simple-studio/videos",
  "/simple-studio/copy",
  "/content",
  "/calendar",
  "/billing",
  "/settings",
  ...settingsSections.map((section) => `/settings?section=${section}`),
];
const routeFilter = process.env.RTL_SMOKE_ROUTE?.trim() || null;
const routes = routeFilter ? [routeFilter.startsWith("/") ? routeFilter : `/${routeFilter}`] : defaultRoutes;
const includePricing = !routeFilter;
const defaultViewports = [
  { name: "mobile", width: 390, height: 844 },
  { name: "tablet", width: 768, height: 1024 },
  { name: "desktop", width: 1440, height: 1000 },
];
const viewportFilter = process.env.RTL_SMOKE_VIEWPORT?.trim() || null;
const viewports = viewportFilter ? defaultViewports.filter((item) => item.name === viewportFilter) : defaultViewports;
if (!viewports.length) throw new Error("RTL_SMOKE_VIEWPORT must be mobile, tablet, or desktop.");
const defaultLocales = [
  { locale: "ar", direction: "rtl" },
  { locale: "en", direction: "ltr" },
];
const localeFilter = process.env.RTL_SMOKE_LOCALE?.trim() || null;
const locales = localeFilter ? defaultLocales.filter((item) => item.locale === localeFilter) : defaultLocales;
if (!locales.length) throw new Error("RTL_SMOKE_LOCALE must be ar or en.");
const outputRoot = path.join(process.cwd(), "renders", "rtl-layout");
const cookieJar = new Map();
let workspaceId = "";
let originalLocale = "ar";

function captureCookies(response) {
  const values = typeof response.headers.getSetCookie === "function"
    ? response.headers.getSetCookie()
    : [response.headers.get("set-cookie")].filter(Boolean);
  for (const value of values) {
    const pair = value.split(";", 1)[0];
    const separator = pair.indexOf("=");
    if (separator > 0) cookieJar.set(pair.slice(0, separator), pair.slice(separator + 1));
  }
}

function cookieHeader() {
  return [...cookieJar].map(([name, value]) => `${name}=${value}`).join("; ");
}

async function request(relative, init = {}) {
  const response = await fetch(new URL(relative, baseUrl), {
    ...init,
    headers: { cookie: cookieHeader(), ...(init.headers || {}) },
    redirect: init.redirect || "manual",
  });
  captureCookies(response);
  return response;
}

async function authenticate() {
  const response = await request("/api/auth/sign-in/email", {
    method: "POST",
    headers: { "content-type": "application/json", origin: baseUrl.origin },
    body: JSON.stringify({
      email: process.env.SMOKE_EMAIL || "alice@nodebanana.dev",
      password: process.env.SMOKE_PASSWORD || "Password123!",
    }),
  });
  if (!response.ok || !cookieHeader()) throw new Error("Seeded-user sign-in failed.");
  await response.arrayBuffer();

  const workspaces = await request("/api/studio/workspaces");
  const body = await workspaces.json();
  workspaceId = body.workspaces?.find((workspace) => workspace.id === (process.env.SMOKE_WORKSPACE_ID || "seed_ws_alice"))?.id || "";
  if (!workspaces.ok || !workspaceId) throw new Error("The seeded Workspace is unavailable.");

  const dashboard = await request("/dashboard", { headers: { "x-workspace-id": workspaceId } });
  const html = await dashboard.text();
  originalLocale = /<html\b[^>]*\blang=["']en["']/i.test(html) ? "en" : "ar";
}

async function setLocale(locale) {
  const response = await request("/api/preferences/locale", {
    method: "POST",
    headers: { "content-type": "application/json", origin: baseUrl.origin, "x-workspace-id": workspaceId },
    body: JSON.stringify({ locale }),
  });
  if (!response.ok) throw new Error(`Locale ${locale} persistence returned HTTP ${response.status}.`);
  await response.arrayBuffer();
}

async function waitForJson(url) {
  let cause;
  for (let attempt = 0; attempt < 60; attempt++) {
    try {
      const response = await fetch(url);
      if (response.ok) return response.json();
      cause = new Error(`HTTP ${response.status}`);
    } catch (error) { cause = error; }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw cause || new Error("Chrome DevTools did not become available.");
}

function cdp(socket) {
  let nextId = 0;
  const pending = new Map();
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(String(event.data));
    if (!message.id) return;
    const waiter = pending.get(message.id);
    if (!waiter) return;
    pending.delete(message.id);
    if (message.error) waiter.reject(new Error(message.error.message));
    else waiter.resolve(message.result);
  });
  return (method, params = {}) => {
    const id = ++nextId;
    socket.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
  };
}

async function waitForStableLayout(call) {
  for (let attempt = 0; attempt < 150; attempt++) {
    const state = await call("Runtime.evaluate", { expression: "document.readyState", returnByValue: true });
    if (state.result.value === "complete") break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  await call("Runtime.evaluate", {
    awaitPromise: true,
    returnByValue: true,
    expression: "document.fonts.ready.then(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))))",
  });
  for (let attempt = 0; attempt < 30; attempt++) {
    const pending = await call("Runtime.evaluate", {
      returnByValue: true,
      expression: `([...document.querySelectorAll('.animate-spin')].filter((element) => {
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
      }).length)`,
    });
    if (pending.result.value === 0) break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  await new Promise((resolve) => setTimeout(resolve, 250));
}

function slug(route) {
  return route.replace(/^\//, "").replace(/[^A-Za-z0-9_-]+/gu, "_").replace(/_+$/u, "") || "root";
}

await authenticate();
await mkdir(outputRoot, { recursive: true });
const userDataDir = await mkdtemp(path.join(tmpdir(), "node-banana-rtl-"));
const debugPort = 9334;
const chrome = spawn(chromeBinary, [
  "--headless=new",
  "--disable-background-networking",
  "--disable-gpu",
  "--no-first-run",
  "--no-default-browser-check",
  `--remote-debugging-port=${debugPort}`,
  `--user-data-dir=${userDataDir}`,
  "about:blank",
], { stdio: "ignore" });
const stop = () => { if (!chrome.killed) chrome.kill("SIGTERM"); };
process.on("exit", stop);
process.on("SIGINT", () => { stop(); process.exit(130); });

const failures = [];
const screenshots = [];
let socket;
try {
  await waitForJson(`http://127.0.0.1:${debugPort}/json/version`);
  const targets = await waitForJson(`http://127.0.0.1:${debugPort}/json/list`);
  const target = targets.find((candidate) => candidate.type === "page");
  if (!target?.webSocketDebuggerUrl) throw new Error("Chrome page target is unavailable.");
  socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });
  const call = cdp(socket);
  await call("Page.enable");
  await call("Runtime.enable");
  await call("Network.enable");

  for (const { locale, direction } of locales) {
    await setLocale(locale);
    await call("Network.setCookies", {
      cookies: [...cookieJar].map(([name, value]) => ({ name, value, url: baseUrl.origin })),
    });
    for (const viewport of viewports) {
      await call("Emulation.setDeviceMetricsOverride", { width: viewport.width, height: viewport.height, deviceScaleFactor: 1, mobile: viewport.width < 800 });
      for (const route of [...routes, ...(includePricing ? [`/${locale}/pricing`] : [])]) {
        const url = new URL(route, baseUrl).toString();
        await call("Page.navigate", { url });
        await waitForStableLayout(call);
        const result = await call("Runtime.evaluate", {
          returnByValue: true,
          expression: `(() => {
            const root = document.documentElement;
            const body = document.body;
            const main = document.querySelector('main');
            const heading = document.querySelector('h1');
            const viewportWidth = root.clientWidth;
            const headingRect = heading?.getBoundingClientRect();
            const overflowOffenders = [...document.querySelectorAll('body *')].flatMap((element) => {
              const style = getComputedStyle(element);
              const rect = element.getBoundingClientRect();
              if (style.display === 'none' || style.visibility === 'hidden' || rect.width <= 0 || (rect.left >= -0.5 && rect.right <= viewportWidth + 0.5)) return [];
              return [{
                tag: element.tagName.toLowerCase(),
                slot: element.getAttribute('data-slot'),
                left: Math.round(rect.left * 10) / 10,
                right: Math.round(rect.right * 10) / 10,
                width: Math.round(rect.width * 10) / 10,
                classes: String(element.className || '').slice(0, 180),
              }];
            }).sort((a, b) => b.width - a.width).slice(0, 12);
            const bidiIsolationOffenders = [];
            const textWalker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT);
            const technicalIdentifier = /\\b[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+(?:=[A-Za-z0-9._:-]+)?\\b/gu;
            while (textWalker.nextNode()) {
              const textNode = textWalker.currentNode;
              const parent = textNode.parentElement;
              const matches = textNode.textContent?.match(technicalIdentifier) || [];
              if (!parent || matches.length === 0 || parent.closest('bdi,[dir="ltr"],[dir="auto"]')) continue;
              const style = getComputedStyle(parent);
              const rect = parent.getBoundingClientRect();
              if (style.display === 'none' || style.visibility === 'hidden' || rect.width <= 0 || rect.height <= 0) continue;
              bidiIsolationOffenders.push(...matches.map((identifier) => ({ identifier, tag: parent.tagName.toLowerCase(), classes: String(parent.className || '').slice(0, 180) })));
            }
            return {
              url: location.href,
              lang: root.lang,
              dir: root.dir,
              viewportWidth,
              scrollWidth: Math.max(root.scrollWidth, body?.scrollWidth || 0),
              mainPresent: Boolean(main),
              headingVisible: Boolean(headingRect && headingRect.width > 0 && headingRect.height > 0 && headingRect.right > 0 && headingRect.left < viewportWidth),
              overflowOffenders,
              bidiIsolationOffenders: bidiIsolationOffenders.slice(0, 12),
            };
          })()`,
        });
        const observation = result.result.value;
        const expectedLocation = new URL(url);
        const actualLocation = new URL(observation.url);
        const expectedPath = `${expectedLocation.pathname}${expectedLocation.search}`;
        const actualPath = `${actualLocation.pathname}${actualLocation.search}`;
        const reasons = [];
        if (actualPath !== expectedPath) reasons.push(`redirected to ${actualPath}`);
        if (observation.lang !== locale) reasons.push(`lang=${observation.lang}`);
        if (observation.dir !== direction) reasons.push(`dir=${observation.dir}`);
        if (observation.scrollWidth > observation.viewportWidth + 1) reasons.push(`horizontal overflow ${observation.scrollWidth}px > ${observation.viewportWidth}px`);
        if (!observation.mainPresent) reasons.push("main landmark missing");
        if (!observation.headingVisible) reasons.push("primary heading missing or outside viewport");
        if (direction === "rtl" && observation.bidiIsolationOffenders.length > 0) reasons.push(`unisolated technical identifiers: ${observation.bidiIsolationOffenders.map((item) => item.identifier).join(", ")}`);

        const directory = path.join(outputRoot, locale, viewport.name);
        await mkdir(directory, { recursive: true });
        const screenshotPath = path.join(directory, `${slug(route)}.png`);
        const screenshot = await call("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
        await writeFile(screenshotPath, Buffer.from(screenshot.data, "base64"));
        screenshots.push(screenshotPath);
        if (reasons.length) failures.push({ locale, viewport: viewport.name, route, reasons, overflowOffenders: observation.overflowOffenders, bidiIsolationOffenders: observation.bidiIsolationOffenders });
      }
    }
  }
} finally {
  socket?.close();
  await terminateChild(chrome);
  await rm(userDataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  try { await setLocale(originalLocale); }
  catch (error) { process.stderr.write(`[WARN] Could not restore the original locale: ${error instanceof Error ? error.message : "unknown"}\n`); }
}

const report = {
  schema: "rtl-visual-smoke/v1",
  generatedAt: new Date().toISOString(),
  baseUrl: baseUrl.origin,
  workspaceId,
  locales: locales.map((item) => item.locale),
  viewports,
  routesPerCell: routes.length + (includePricing ? 1 : 0),
  screenshotCount: screenshots.length,
  failures,
  manualReviewRequired: true,
};
await writeFile(path.join(outputRoot, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
if (failures.length) {
  process.stderr.write(`${JSON.stringify(report, null, 2)}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write(`[OK] Stable Chrome RTL/LTR geometry (${screenshots.length} screenshots; manual visual review still required)\n`);
  process.stdout.write(`[OK] Report: ${path.join(outputRoot, "report.json")}\n`);
}
