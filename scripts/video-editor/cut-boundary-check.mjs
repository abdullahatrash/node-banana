import { createRequire } from "node:module";
import assert from "node:assert/strict";
const require = createRequire(import.meta.url),
  { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const browser = await chromium.launch({ channel: "chrome", headless: true });
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 900 },
  });
  await page.goto("http://127.0.0.1:3048/?lang=en");
  await page.getByRole("button", { name: /^Phone footage / }).click();
  await page.getByLabel("Trim end", { exact: true }).fill("5");
  for (const advance of [false, true]) {
    await page.getByLabel("Timeline", { exact: true }).fill("2");
    if (advance)
      await page.getByLabel("Timeline", { exact: true }).press("ArrowRight");
    await page
      .getByRole("button", { name: "Split at playhead", exact: true })
      .click();
  }
  await page
    .getByRole("button", { name: "Main video section 2", exact: true })
    .focus();
  await page
    .getByRole("button", { name: "Main video section 2", exact: true })
    .press("Enter");
  await page
    .getByRole("button", { name: "Delete section", exact: true })
    .click();
  await page.getByLabel("Timeline", { exact: true }).fill("1.6");
  await page.waitForFunction(
    () =>
      !document.querySelector("video").seeking &&
      document.querySelector("video").readyState >= 2,
  );
  await page.evaluate(() => {
    window.cutSeeks = [];
    document.querySelector("video").addEventListener("seeking", () =>
      window.cutSeeks.push({
        time: Number(
          document.querySelector('input[aria-label="Timeline"]').value,
        ),
        source: document.querySelector("video").currentTime,
      }),
    );
  });
  await page.getByRole("button", { name: "Play", exact: true }).click();
  await page.waitForFunction(
    () =>
      Number(document.querySelector('input[aria-label="Timeline"]').value) >
      2.4,
    undefined,
    { timeout: 10000 },
  );
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  const seeks = await page.evaluate(() => window.cutSeeks);
  assert.ok(
    seeks.some((event) => event.time >= 1.98 && event.time <= 2.1),
    `One-frame cut did not trigger a seek: ${JSON.stringify(seeks)}`,
  );
  console.log(JSON.stringify({ seeks }));
} finally {
  await browser.close();
}
