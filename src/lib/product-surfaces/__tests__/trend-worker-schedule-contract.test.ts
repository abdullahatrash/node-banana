import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

type DeploymentConfiguration = {
  functions: Record<string, { maxDuration: number }>;
  crons: Array<{ path: string; schedule: string }>;
};

describe("trend intelligence deployment schedule", () => {
  it("continuously runs discovery and licensed-media materialization workers", () => {
    const configuration = JSON.parse(
      readFileSync("vercel.json", "utf8"),
    ) as DeploymentConfiguration;

    expect(configuration.functions).toMatchObject({
      "src/app/api/studio/internal/youtube-trends/route.ts": {
        maxDuration: 60,
      },
      "src/app/api/studio/internal/licensed-trend-materialization/route.ts": {
        maxDuration: 60,
      },
    });
    expect(configuration.crons).toContainEqual({
      path: "/api/studio/internal/youtube-trends?limit=20",
      schedule: "*/5 * * * *",
    });
    expect(configuration.crons).toContainEqual({
      path: "/api/studio/internal/licensed-trend-materialization?limit=10",
      schedule: "* * * * *",
    });
  });
});
