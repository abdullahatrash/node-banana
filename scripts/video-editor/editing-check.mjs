import { createRequire } from "node:module";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import assert from "node:assert/strict";
const require = createRequire(import.meta.url),
  { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const out =
  process.env.EDITOR_TEST_OUTPUT || join(tmpdir(), "tasmeemai-editor-editing");
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ channel: "chrome", headless: true });
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 900 },
    acceptDownloads: true,
  });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("http://127.0.0.1:3048/?lang=en");
  await page.getByRole("button", { name: /^Phone footage / }).click();
  await page.getByLabel("Trim end", { exact: true }).fill("10");
  for (const [role, name] of [
    ["secondary", "AI influencer"],
    ["music", "Music"],
    ["voiceover", "Voice over"],
  ]) {
    await page.getByLabel("Add media to").selectOption(role);
    await page.getByRole("button", { name: new RegExp(`^${name} `) }).click();
    await page.getByLabel("Volume", { exact: true }).fill("0.2");
  }
  await page.getByRole("button", { name: "Main video", exact: true }).click();
  for (const time of [3, 6]) {
    await page.getByLabel("Timeline", { exact: true }).fill(String(time));
    await page
      .getByRole("button", { name: "Split at playhead", exact: true })
      .click();
  }
  assert.equal(
    await page.getByRole("button", { name: /^Main video section / }).count(),
    3,
  );
  await page
    .getByRole("button", { name: "Main video section 2", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Delete section", exact: true })
    .click();
  assert.equal(
    await page.getByRole("button", { name: /^Main video section / }).count(),
    2,
  );
  await page.getByLabel("Timeline", { exact: true }).fill("4");
  await page.waitForFunction(
    () => Math.abs(document.querySelector("video")?.currentTime - 7) < 0.05,
  );
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  assert.equal(
    await page.getByRole("button", { name: /^Main video section / }).count(),
    3,
  );
  await page.getByRole("button", { name: "Redo", exact: true }).click();
  await page.getByLabel("Timeline", { exact: true }).fill("2.8");
  await page.getByRole("button", { name: "Play", exact: true }).click();
  await page.waitForFunction(
    () =>
      Number(document.querySelector('input[aria-label="Timeline"]').value) >
      3.5,
    { timeout: 10000 },
  );
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  const playback = await page.evaluate(() => ({
    time: Number(document.querySelector('input[aria-label="Timeline"]').value),
    source: document.querySelector("video").currentTime,
  }));
  assert.ok(
    Math.abs(playback.source - playback.time - 3) < 0.2,
    JSON.stringify(playback),
  );
  // Keyboard and mouse use the same bounded trim path.
  const handle = page.getByRole("slider", {
    name: "Main video 2: Trim end",
    exact: true,
  });
  await handle.press("ArrowLeft");
  assert.ok(Number(await handle.getAttribute("aria-valuenow")) < 10);
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  const bounds = await handle.boundingBox();
  await page.mouse.move(
    bounds.x + bounds.width / 2,
    bounds.y + bounds.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(bounds.x - 70, bounds.y + bounds.height / 2, {
    steps: 8,
  });
  await page.mouse.up();
  assert.ok(Number(await handle.getAttribute("aria-valuenow")) < 9.9);
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await page.getByRole("button", { name: "Add text", exact: true }).click();
  await page
    .getByLabel("Overlay text", { exact: true })
    .fill("مرحبا بالعالم\nArabic typeface 2026");
  const fonts = [];
  for (const font of ["sans", "cairo", "naskh"]) {
    await page.getByLabel("Typeface", { exact: true }).selectOption(font);
    const family = {
      sans: "EditorArabic",
      cairo: "EditorCairo",
      naskh: "EditorNaskh",
    }[font];
    await page.evaluate(
      (family) => document.fonts.load(`400 76px ${family}`),
      family,
    );
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await page.getByText("Saved", { exact: true }).waitFor();
    const url = page.url();
    await page.reload();
    await page.getByRole("button", { name: "Add text", exact: true }).click();
    assert.equal(
      await page.getByLabel("Typeface", { exact: true }).inputValue(),
      font,
    );
    await page
      .getByRole("button", { name: "Export video", exact: true })
      .click();
    const link = page.getByRole("link", {
      name: "Download video",
      exact: true,
    });
    await link.waitFor({ timeout: 120000 });
    const download = page.waitForEvent("download");
    await link.click();
    await (await download).saveAs(join(out, `${font}.mp4`));
    fonts.push({ font, url });
  }
  const viewports = [];
  for (const [width, height] of [
    [1440, 900],
    [1280, 720],
    [1024, 600],
    [390, 844],
    [360, 640],
    [844, 390],
    [1024, 400],
    [1280, 400],
  ]) {
    await page.setViewportSize({ width, height });
    await page
      .getByRole("button", { name: "Fit to screen", exact: true })
      .click();
    await page
      .waitForFunction(
        () =>
          document.querySelector("video")?.parentElement.getBoundingClientRect()
            .height > 40,
        undefined,
        { timeout: 5000 },
      )
      .catch(async (error) => {
        await page.screenshot({ path: join(out, "failed-viewport.png") });
        console.log(
          await page
            .locator("main, fieldset, section, video")
            .evaluateAll((elements) =>
              elements.map((element) => ({
                tag: element.tagName,
                className: element.className,
                display: getComputedStyle(element).display,
                rect: element.getBoundingClientRect().toJSON(),
              })),
            ),
        );
        throw error;
      });
    const measurement = await page.evaluate(() => {
      const timeline = document
        .querySelector('[aria-label="Timeline tracks"]')
        .getBoundingClientRect();
      const canvas = document
        .querySelector("video")
        .parentElement.getBoundingClientRect();
      return {
        timelineBottom: timeline.bottom,
        canvasBottom: canvas.bottom,
        canvasRight: canvas.right,
        canvasLeft: canvas.left,
        timelineRight: timeline.right,
        timelineLeft: timeline.left,
        canvasWidth: canvas.width,
        canvasHeight: canvas.height,
        timelineTop: timeline.top,
        scrollHeight: document.documentElement.scrollHeight,
        scrollWidth: document.documentElement.scrollWidth,
      };
    });
    assert.ok(
      measurement.timelineBottom <= height + 1,
      JSON.stringify({ width, height, ...measurement }),
    );
    assert.ok(
      measurement.canvasBottom <= measurement.timelineTop + 1 ||
        measurement.canvasRight <= measurement.timelineLeft + 1 ||
        measurement.canvasLeft >= measurement.timelineRight - 1,
      JSON.stringify(measurement),
    );
    assert.ok(
      measurement.scrollHeight <= height + 1 &&
        measurement.scrollWidth <= width + 1,
      JSON.stringify(measurement),
    );
    assert.ok(measurement.canvasHeight > 40, JSON.stringify(measurement));
    await page.screenshot({ path: join(out, `${width}x${height}.png`) });
    viewports.push({ width, height, ...measurement });
  }
  assert.deepEqual(errors, []);
  await writeFile(
    join(out, "results.json"),
    JSON.stringify({ playback, fonts, viewports, errors }, null, 2),
  );
  console.log(JSON.stringify({ playback, fonts, viewports, errors }));
} finally {
  await browser.close();
}
