import { createRequire } from "node:module";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
const run = promisify(execFile),
  require = createRequire(import.meta.url),
  { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const out =
  process.env.EDITOR_TEST_OUTPUT || join(tmpdir(), "tasmeemai-editor-soak");
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ channel: "chrome", headless: true });
const cdp = await browser.newBrowserCDPSession();
const rss = async () => {
  const { processInfo } = await cdp.send("SystemInfo.getProcessInfo");
  const { stdout } = await run("ps", [
    "-o",
    "rss=",
    "-p",
    processInfo.map((item) => item.id).join(","),
  ]);
  return stdout
    .trim()
    .split(/\s+/)
    .reduce((sum, value) => sum + Number(value), 0);
};
try {
  const page = await browser.newPage({
      viewport: { width: 1366, height: 900 },
    }),
    errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("http://127.0.0.1:3048/?lang=en");
  await page.getByRole("button", { name: /Phone footage/ }).click();
  await page.getByLabel("Trim end", { exact: true }).fill("5");
  for (const [role, name] of [
    ["secondary", "AI influencer"],
    ["music", "Music"],
    ["voiceover", "Voice over"],
  ]) {
    await page.getByLabel("Add media to").selectOption(role);
    await page.getByRole("button", { name: new RegExp(`^${name} `) }).click();
    await page.getByLabel("Volume", { exact: true }).fill("0.2");
  }
  await page.getByRole("button", { name: "Add text", exact: true }).click();
  const begin = Date.now(),
    stop = begin + Number(process.env.EDITOR_SOAK_SECONDS || 180) * 1000,
    samples = [];
  let cycles = 0;
  while (Date.now() < stop) {
    await page
      .getByLabel("Overlay text", { exact: true })
      .fill(`تجربة ممتدة ${cycles}\nEditor session`);
    await page.getByLabel("Timeline", { exact: true }).fill(String(cycles % 5));
    await page
      .getByRole("button", { name: "Export video", exact: true })
      .click();
    await page
      .getByRole("link", { name: "Download video", exact: true })
      .waitFor({ timeout: 120000 });
    const attempts = await page.evaluate(async () => {
      const root = await (
        await navigator.storage.getDirectory()
      ).getDirectoryHandle("tasmeemai-video-editor-v1");
      let count = 0;
      for await (const entry of root.keys()) count++;
      return count;
    });
    if (attempts !== 1) throw Error(`Leaked attempts: ${attempts}`);
    samples.push({ atMs: Date.now() - begin, rssKiB: await rss(), attempts });
    cycles++;
  }
  if (errors.length) throw Error(errors.join("\n"));
  const result = {
    elapsedMs: Date.now() - begin,
    cycles,
    firstRssKiB: samples[0].rssKiB,
    lastRssKiB: samples.at(-1).rssKiB,
    peakRssKiB: Math.max(...samples.map((row) => row.rssKiB)),
    errors,
    samples,
  };
  await writeFile(join(out, "results.json"), JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ ...result, samples: undefined }));
} finally {
  await browser.close();
}
