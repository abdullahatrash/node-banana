import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

describe("Replicate qualification operator contract", () => {
  it("documents the explicit paid flag, no-call default, durable cap, and every trusted prerequisite", () => {
    const environment = readFileSync(".env.example", "utf8")
    const guide = readFileSync("docs/model-qualification-operations.md", "utf8")
    const packageJson = readFileSync("package.json", "utf8")
    const preflight = readFileSync("scripts/check-replicate-qualification.ts", "utf8")
    const script = readFileSync("scripts/qualify-replicate-model.ts", "utf8")
    expect(script).toContain('process.argv[3] !== "--execute-paid-smoke"')
    expect(packageJson).toContain('"qualify:replicate:check": "tsx scripts/check-replicate-qualification.ts"')
    expect(packageJson).toContain('"qualify:replicate:inspect": "tsx scripts/inspect-replicate-qualification-contract.ts"')
    expect(preflight).toContain('args.includes("--execute-paid-smoke")')
    expect(preflight).toContain("paidCallsMade: false")
    expect(preflight).toContain("loadEnvConfig(process.cwd())")
    expect(guide).toContain("pnpm qualify:replicate:check")
    for (const value of ["--execute-paid-smoke", "no provider calls", "0103_model_qualification_account_spend", "below USD 0.40", "signed provider-account billing receipt", "Legacy qualification rows"]) expect(guide).toContain(value)
    for (const key of ["REPLICATE_QUALIFICATION_API_TOKEN", "QUALIFICATION_HARNESS_TOKEN", "QUALIFICATION_WEBHOOK_URL", "QUALIFICATION_WEBHOOK_OBSERVER_URL", "QUALIFICATION_INGESTION_URL", "QUALIFICATION_SPEND_OBSERVER_URL", "QUALIFICATION_SPEND_RECEIPT_PUBLIC_KEYS_JSON"]) expect(environment).toContain(`${key}=`)
  })
})
