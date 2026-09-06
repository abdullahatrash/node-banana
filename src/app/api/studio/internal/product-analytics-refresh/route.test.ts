import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

describe("analytics refresh cron route", () => {
  it("requires internal or cron authorization and executes the leased worker", () => {
    const route = readFileSync("src/app/api/studio/internal/product-analytics-refresh/route.ts", "utf8")
    expect(route).toContain("ensureInternalStudioOrCronAuth(request)")
    expect(route).toContain("PRODUCTION_ANALYTICS_REFRESH_WORKER.run")
    expect(route).toContain("x-vercel-id")
  })

  it("is scheduled with a bounded runtime", () => {
    const config = JSON.parse(readFileSync("vercel.json", "utf8")) as { functions: Record<string, { maxDuration: number }>; crons: Array<{ path: string; schedule: string }> }
    expect(config.functions["src/app/api/studio/internal/product-analytics-refresh/route.ts"]).toEqual({ maxDuration: 60 })
    expect(config.crons).toContainEqual({ path: "/api/studio/internal/product-analytics-refresh", schedule: "* * * * *" })
  })
})
