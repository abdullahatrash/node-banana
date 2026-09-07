import { createRequire } from "node:module";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { mkdir, writeFile } from "node:fs/promises";
const require = createRequire(import.meta.url),
  { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const fixtures =
  process.env.EDITOR_FIXTURES ||
  join(tmpdir(), "tasmeemai-throwaway-reaction-export-v1");
const out =
  process.env.EDITOR_TEST_OUTPUT || join(tmpdir(), "tasmeemai-editor-variants");
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ channel: "chrome", headless: true });
try {
  const page = await browser.newPage({
    viewport: { width: 1366, height: 900 },
    acceptDownloads: true,
  });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("http://127.0.0.1:3048/?lang=en");
  await page.getByRole("button", { name: /Phone footage/ }).click();
  await page.getByLabel("Trim end", { exact: true }).fill("5");
  await page.getByLabel("Add media to").selectOption("music");
  const results = [];
  for (const name of [
    "music.wav",
    "music-44100.wav",
    "music-44100.mp3",
    "music-vbr.mp3",
    "music-mono.mp3",
    "music-untagged.mp3",
  ]) {
    await page
      .getByLabel("Upload video or audio")
      .setInputFiles(join(fixtures, name));
    await page
      .getByRole("button", {
        name: new RegExp(`^${name.replaceAll(".", "\\.")} `),
      })
      .last()
      .click();
    await page.getByLabel("Trim end", { exact: true }).fill("4");
    await page.getByLabel("Start on timeline").fill("1");
    const begin = Date.now();
    await page
      .getByRole("button", { name: "Export video", exact: true })
      .click();
    await page
      .getByRole("link", { name: "Download video", exact: true })
      .waitFor({ timeout: 120000 });
    const download = page.waitForEvent("download");
    await page
      .getByRole("link", { name: "Download video", exact: true })
      .click();
    await (await download).saveAs(join(out, `${name}.mp4`));
    results.push({ name, elapsedMs: Date.now() - begin });
  }
  await page
    .getByLabel("Upload video or audio")
    .setInputFiles(join(fixtures, "malformed.mp3"));
  await page.getByRole("alert").waitFor();
  if ((await page.getByLabel("Start on timeline").inputValue()) !== "1")
    throw Error("Malformed upload lost composition");
  // Repeated edits exercise history bounds and responsive scrubbing in one session.
  for (let i = 0; i < 100; i++) {
    await page
      .getByLabel("Volume", { exact: true })
      .fill(String((i % 10) / 10));
    await page
      .getByLabel("Timeline", { exact: true })
      .fill(String((i % 45) / 10));
  }
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await page.getByRole("button", { name: "Redo", exact: true }).click();
  const mute = page.getByLabel("Mute · Music");
  await mute.check();
  await page.getByRole("button", { name: "Export video", exact: true }).click();
  await page
    .getByRole("link", { name: "Download video", exact: true })
    .waitFor();
  const muted = page.waitForEvent("download");
  await page.getByRole("link", { name: "Download video", exact: true }).click();
  await (await muted).saveAs(join(out, "muted.mp4"));
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await page.getByText("Saved", { exact: true }).waitFor();
  const url = new URL(page.url());
  url.searchParams.set("lang", "ar");
  await page.goto(url.href);
  await page
    .getByRole("button", { name: "الفيديو الثانوي", exact: true })
    .waitFor();
  if ((await page.locator("main").getAttribute("dir")) !== "rtl")
    throw Error("Arabic direction lost");
  await page.getByRole("button", { name: "إضافة نص", exact: true }).click();
  await page
    .getByLabel("نص الفيديو", { exact: true })
    .fill("تجربة عربية\nسطر ثانٍ");
  await page
    .getByRole("button", { name: "تحريك النص أو تحريره", exact: true })
    .focus();
  await page.keyboard.press("ArrowLeft");
  await page.screenshot({ path: join(out, "arabic.png"), fullPage: true });
  if (errors.length) throw Error(errors.join("\n"));
  await writeFile(
    join(out, "results.json"),
    JSON.stringify(
      { results, repeatedEdits: 100, errors, browser: browser.version() },
      null,
      2,
    ),
  );
  console.log(JSON.stringify({ results, output: out }));
} finally {
  await browser.close();
}
