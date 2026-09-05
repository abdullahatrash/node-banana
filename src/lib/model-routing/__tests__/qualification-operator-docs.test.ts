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
    expect(packageJson).toContain('"qualify:replicate:review": "tsx scripts/review-replicate-qualification-artifact.ts"')
    expect(packageJson).toContain('"qualify:replicate:spend": "tsx scripts/import-replicate-qualification-spend.ts"')
    expect(preflight).toContain('args.includes("--execute-paid-smoke")')
    expect(preflight).toContain("paidCallsMade: false")
    expect(preflight).toContain("loadEnvConfig(process.cwd())")
    expect(guide).toContain("pnpm qualify:replicate:check")
    for (const value of ["--execute-paid-smoke", "no provider calls", "0131_model_qualification_spend_evidence", "below USD 0.40", "signed provider-account billing receipt", "qualify:replicate:review --list", "qualify:replicate:spend -- --list", "--confirm-exact-prediction-charge", "Aggregate account totals", "Legacy qualification rows"]) expect(guide).toContain(value)
    for (const key of ["REPLICATE_QUALIFICATION_API_TOKEN", "QUALIFICATION_HARNESS_TOKEN", "QUALIFICATION_WEBHOOK_URL", "QUALIFICATION_WEBHOOK_OBSERVER_URL", "QUALIFICATION_INGESTION_URL", "QUALIFICATION_SPEND_OBSERVER_URL", "QUALIFICATION_SPEND_RECEIPT_PUBLIC_KEYS_JSON", "QUALIFICATION_SPEND_SIGNING_KEY_ID", "QUALIFICATION_SPEND_SIGNING_PRIVATE_KEY"]) expect(environment).toContain(`${key}=`)
  })

  it("keeps the local setup wizard repeatable and preserves the paid boundary", () => {
    const wizard = readFileSync("scripts/setup-local-replicate-qualification.sh", "utf8")
    const stages = wizard.split("# STAGES — author this section.")[1] ?? ""
    const packageJson = readFileSync("package.json", "utf8")
    const readme = readFileSync("README.md", "utf8")
    const gitignore = readFileSync(".gitignore", "utf8")

    expect(packageJson).toContain('"setup:replicate:qualification": "bash scripts/setup-local-replicate-qualification.sh"')
    expect(readme).toContain("pnpm setup:replicate:qualification")
    expect(gitignore).toContain(".local-secrets/")
    expect(stages).not.toContain("set_secret ")
    expect(stages).toContain('[[ "$BYOK_KEY_ENCRYPTION_KEY" =~ ^[a-f0-9]{64}$ ]]')
    expect(stages).toContain('REGION_TRUST=$(_existing GOVERNANCE_REGION_TRUST_KEYS || true)')
    expect(stages).toContain("Set signingKeyId to '$MODEL_SIGNING_KEY_ID'")
    expect(stages).toContain("pnpm qualify:replicate:check")
    expect(stages).toContain('pnpm qualify:replicate:portfolio -- "${QUALIFICATION_PLAN_PATHS[@]}"')
    expect(stages).toContain("pnpm qualify:replicate:review -- --list")
    expect(stages).toContain("pnpm qualify:replicate:spend -- --list")
    expect(stages).toContain('flatMap((path)=>')

    const portfolioPreflight = stages.indexOf('pnpm qualify:replicate:portfolio -- "${QUALIFICATION_PLAN_PATHS[@]}"')
    const confirmation = stages.indexOf('confirm "Run this exact reviewed portfolio now')
    const paidExecution = stages.indexOf('pnpm qualify:replicate "$QUALIFICATION_PLAN_PATH" --execute-paid-smoke')
    expect(portfolioPreflight).toBeGreaterThan(-1)
    expect(confirmation).toBeGreaterThan(portfolioPreflight)
    expect(confirmation).toBeGreaterThan(-1)
    expect(paidExecution).toBeGreaterThan(confirmation)
  })
})
