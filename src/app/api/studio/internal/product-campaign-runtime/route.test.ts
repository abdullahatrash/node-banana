import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(join(process.cwd(), "src/app/api/studio/internal/product-campaign-runtime/route.ts"), "utf8");

describe("product campaign runtime worker route", () => {
  it("requires internal or cron authentication for both entry points", () => {
    expect(source).toContain("ensureInternalStudioOrCronAuth(request)");
    expect(source).toContain("export const GET = handle");
    expect(source).toContain("export const POST = handle");
  });
});
