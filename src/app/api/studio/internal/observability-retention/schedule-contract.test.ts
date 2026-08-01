import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

interface VercelConfiguration {
  crons?: Array<{ path?: string; schedule?: string }>;
}

describe("observability retention deployment schedule", () => {
  it("registers recurring production maintenance in vercel.json", () => {
    const configuration = JSON.parse(
      readFileSync(join(process.cwd(), "vercel.json"), "utf8"),
    ) as VercelConfiguration;

    expect(configuration.crons).toContainEqual({
      path: "/api/studio/internal/observability-retention",
      schedule: "* * * * *",
    });
  });
});
