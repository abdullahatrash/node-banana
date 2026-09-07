import { execFile } from "node:child_process";
import { promisify } from "node:util";
const run = promisify(execFile);
import { createRequire } from "node:module";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const out =
  process.env.EDITOR_TEST_OUTPUT ||
  join(tmpdir(), "tasmeemai-editor-acceptance");
await mkdir(out, { recursive: true });
const duration = Number(process.env.EDITOR_TEST_DURATION || 5);
const fixtureDirectory =
  process.env.EDITOR_FIXTURES ||
  join(tmpdir(), "tasmeemai-throwaway-reaction-export-v1");
const browser = await chromium.launch({ channel: "chrome", headless: true });
let memoryPeakKiB = 0,
  memorySamples = 0,
  sampleBusy = false;
const cdp = await browser.newBrowserCDPSession();
const memoryTimer = setInterval(async () => {
  if (sampleBusy) return;
  sampleBusy = true;
  try {
    const { processInfo } = await cdp.send("SystemInfo.getProcessInfo");
    const ids = processInfo.map((item) => item.id).join(",");
    const { stdout } = await run("ps", ["-o", "rss=", "-p", ids]);
    const total = stdout
      .trim()
      .split(/\s+/)
      .reduce((sum, value) => sum + Number(value), 0);
    memoryPeakKiB = Math.max(memoryPeakKiB, total);
    memorySamples++;
  } catch {
  } finally {
    sampleBusy = false;
  }
}, 250);
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
    acceptDownloads: true,
  });
  const errors = [];
  page.on("pageerror", (e) => {
    errors.push(e.message);
    console.error("PAGE ERROR", e.message);
  });
  page.on("console", (msg) => {
    if (msg.type() === "error") console.error(msg.text());
  });
  const coldStart = Date.now();
  await page.goto("http://127.0.0.1:3048/?lang=en");
  await page.getByRole("button", { name: /Phone footage/ }).waitFor();
  const coldOpenMs = Date.now() - coldStart;
  await page
    .getByLabel("Upload video or audio")
    .setInputFiles(join(fixtureDirectory, "main.mp4"));
  await page.getByRole("button", { name: /^main.mp4 / }).click();
  await page.getByLabel("Trim end", { exact: true }).fill(String(duration));
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await page.getByText("Saved", { exact: true }).waitFor();
  const warmStart = Date.now();
  await page.reload();
  await page.getByLabel("Trim end", { exact: true }).waitFor();
  const warmOpenMs = Date.now() - warmStart;
  if (
    (await page.getByLabel("Trim end", { exact: true }).inputValue()) !==
    String(duration)
  )
    throw Error("Trim did not survive reopen");
  await page.getByLabel("Add media to").selectOption("secondary");
  await page
    .getByLabel("Upload video or audio")
    .setInputFiles(join(fixtureDirectory, "reaction.mp4"));
  await page.getByRole("button", { name: /^reaction.mp4 / }).click();
  await page.getByLabel("Trim end", { exact: true }).fill("2");
  await page.getByLabel("Start on timeline").fill("2");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await page.getByText("Saved", { exact: true }).waitFor();
  await page.getByLabel("Timeline", { exact: true }).fill("3");
  const secondary = page.getByLabel("Secondary video", { exact: true });
  if (!(await secondary.isVisible()))
    throw Error("Secondary video absent during segment");
  await page.getByLabel("Timeline", { exact: true }).fill("4.5");
  if (await secondary.isVisible())
    throw Error("Secondary video did not disappear");
  await page.getByRole("button", { name: "Add text", exact: true }).click();
  await page
    .getByLabel("Overlay text", { exact: true })
    .fill("مرحبا بالعالم\nHello 2026");
  const overlay = page.getByRole("button", { name: "Move or edit text" });
  await overlay.dblclick();
  await page.getByLabel("Edit text on video").fill("السطر الأول\nHello 2026");
  await page.getByLabel("Edit text on video").press("Control+Enter");
  await overlay.press("ArrowUp");
  const bounds = await overlay.boundingBox();
  await page.mouse.move(bounds.x + 5, bounds.y + 5);
  await page.mouse.down();
  await page.mouse.move(bounds.x + 20, bounds.y - 20, { steps: 5 });
  await page.mouse.up();
  await page.getByLabel("Text weight").selectOption("700");
  await page.getByLabel("Text alignment").selectOption("right");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await page.getByText("Saved", { exact: true }).waitFor();
  await page.reload();
  await page.getByRole("button", { name: "Move or edit text" }).click();
  if (
    (await page.getByLabel("Overlay text", { exact: true }).inputValue()) !==
    "السطر الأول\nHello 2026"
  )
    throw Error("Multiline text did not survive reopen");
  for (const [role, name, end, start, gain] of [
    ["music", "Music", String(duration), "0", "0.2"],
    ["voiceover", "Voice over", "1", "3", "0.7"],
  ]) {
    await page.getByLabel("Add media to").selectOption(role);
    await page.getByRole("button", { name: new RegExp(`^${name} `) }).click();
    await page.getByLabel("Trim end", { exact: true }).fill(end);
    await page.getByLabel("Start on timeline").fill(start);
    await page.getByLabel("Volume", { exact: true }).fill(gain);
  }
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await page.getByText("Saved", { exact: true }).waitFor();
  await page.reload();
  await page.getByLabel("Add media to").selectOption("voiceover");
  if ((await page.getByLabel("Volume", { exact: true }).inputValue()) !== "0.7")
    throw Error("Audio gain did not survive reopen");
  await page.getByLabel("Volume", { exact: true }).fill("0.4");
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  if ((await page.getByLabel("Volume", { exact: true }).inputValue()) !== "0.7")
    throw Error("Undo did not restore gain");
  await page.getByRole("button", { name: "Redo", exact: true }).click();
  if ((await page.getByLabel("Volume", { exact: true }).inputValue()) !== "0.4")
    throw Error("Redo did not restore gain");
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  // Failure injection stays at browser/platform boundaries; codecs and worker remain real.
  const encoder = await page.evaluate(() => {
    window.__editorEncoder = window.VideoEncoder;
    window.VideoEncoder = undefined;
    return true;
  });
  await page.getByRole("button", { name: "Export video", exact: true }).click();
  await page.getByRole("alert").filter({ hasText: "Chrome" }).waitFor();
  await page.evaluate(() => {
    window.VideoEncoder = window.__editorEncoder;
  });
  await page.evaluate(() => {
    window.__editorStorage = navigator.storage.getDirectory.bind(
      navigator.storage,
    );
    navigator.storage.getDirectory = async () => {
      throw new DOMException("injected storage full", "QuotaExceededError");
    };
  });
  await page.getByRole("button", { name: "Export video", exact: true }).click();
  await page
    .getByRole("alert")
    .filter({ hasText: "temporary storage" })
    .waitFor();
  await page.evaluate(() => {
    navigator.storage.getDirectory = window.__editorStorage;
  });
  await page.getByRole("button", { name: "Export video", exact: true }).click();
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await page
    .getByRole("button", { name: "Cancel", exact: true })
    .waitFor({ state: "hidden" });
  await page.evaluate(async () => {
    const parent = await (
      await navigator.storage.getDirectory()
    ).getDirectoryHandle("tasmeemai-video-editor-v1", { create: true });
    await parent.getDirectoryHandle("11111111-1111-4111-8111-111111111111", {
      create: true,
    });
  });
  if (duration === 60) {
    await page.getByLabel("Add media to").selectOption("secondary");
    await page.getByLabel("Trim end", { exact: true }).fill("15");
    await page.getByLabel("Start on timeline").fill("5");
  }
  await page.evaluate(() => {
    window.__editorJitter = [];
    let last = performance.now();
    window.__editorJitterTimer = setInterval(() => {
      const now = performance.now();
      window.__editorJitter.push(Math.max(0, now - last - 50));
      last = now;
    }, 50);
  });
  const measurements = [];
  for (const [layout, label] of [
    ["stacked", "Stacked"],
    ["pip", "Picture in picture"],
    ["side-by-side", "Side by side"],
  ]) {
    await page.getByRole("button", { name: label, exact: true }).click();
    const started = Date.now();
    await page
      .getByRole("button", { name: "Export video", exact: true })
      .click();
    await page
      .getByRole("link", { name: "Download video" })
      .waitFor({ timeout: 120000 });
    measurements.push({ layout, elapsedMs: Date.now() - started });
    const pending = page.waitForEvent("download");
    await page.getByRole("link", { name: "Download video" }).click();
    await (await pending).saveAs(join(out, `${layout}.mp4`));
    await page.screenshot({ path: join(out, `${layout}.png`), fullPage: true });
  }

  const jitter = await page.evaluate(() => {
    clearInterval(window.__editorJitterTimer);
    return window.__editorJitter;
  });
  jitter.sort((a, b) => a - b);
  const responsiveness = {
    samples: jitter.length,
    p95TimerDelayMs: jitter[Math.floor(jitter.length * 0.95)],
    maxTimerDelayMs: Math.max(...jitter),
  };
  const attempts = await page.evaluate(async () => {
    const parent = await (
      await navigator.storage.getDirectory()
    ).getDirectoryHandle("tasmeemai-video-editor-v1");
    const names = [];
    for await (const name of parent.keys()) names.push(name);
    return names;
  });
  if (
    attempts.length !== 1 ||
    attempts.includes("11111111-1111-4111-8111-111111111111")
  )
    throw Error(`Temporary attempt cleanup failed: ${attempts}`);
  if (errors.length) throw Error(errors.join("\n"));
  await writeFile(
    join(out, "main-check.json"),
    JSON.stringify(
      {
        coldOpenMs,
        warmOpenMs,
        memoryPeakKiB,
        memorySamples,
        responsiveness,
        measurements,
        browser: browser.version(),
        errors,
      },
      null,
      2,
    ),
  );
  console.log(
    JSON.stringify({
      coldOpenMs,
      warmOpenMs,
      memoryPeakKiB,
      memorySamples,
      responsiveness,
      measurements,
      output: out,
    }),
  );
} finally {
  clearInterval(memoryTimer);
  await browser.close();
}
