# Onboarding schema recovery — 2026-09-06

Production accepted verification email links but returned `ONBOARDING_UNAVAILABLE` when saving onboarding identity. The application caught an unexpected database exception and returned HTTP 503 without a diagnostic log.

Read-only inspection confirmed a reachable database with 165 public tables and an empty `drizzle.__drizzle_migrations` ledger. The initial onboarding tables existed, but later workspace settings, locale preferences, commercial tables, and `ensure_workspace_free_plan_v1` did not. The real repository inserts all mapped workspace-settings columns, including defaulted columns, so those missing columns also blocked creation.

## Recovery performed

`scripts/db-repair-onboarding-prerequisites.mjs` defaults to a read-only presence check. `--apply` permits only the exact fully absent prerequisite set observed during this incident. A partial state fails closed for manual review. The repair runs in one transaction with an advisory lock, a 5-second lock timeout and a 30-second statement timeout.

The repair uses existing authored migration SQL:

- 0090: commercial schema prerequisites (14 tables, no customer data changes).
- 0102: workspace scheduling timezone and week start.
- 0105: workspace interface locale and membership-scoped locale preferences, including the original locale backfill.
- 0116: the plan-catalog insert only. Credit-pack checkout remains outside this repair.
- 0118: the free-plan function definition only. The loop granting credits to existing workspaces is deliberately excluded.
- 0126: workspace content market.

The production transaction completed successfully. Its postflight found all 15 tables, four settings columns, and the activation function present. No historical migrations were marked as applied. No email was sent, no existing workspace was given credits, and no customer records were deleted by the repair.

## Verification

A schema-only production export was restored to an isolated local Postgres database. No customer rows were copied. The actual onboarding service failed to save identity against that original schema. After the repair it saved identity, advanced to `brand_source`, persisted the scoped Arabic locale, and granted exactly 10 free credits. Replaying the command reused the workspace without duplicating credits. Running the repair a second time was a no-op.

The integration test is opt-in and refuses any database except `127.0.0.1/.../onboarding_rehearsal`:

```sh
ONBOARDING_REHEARSAL_DATABASE_URL=postgresql://postgres:LOCAL_PASSWORD@127.0.0.1:55437/onboarding_rehearsal pnpm exec vitest run src/lib/onboarding/__tests__/production-schema-rehearsal.test.ts
```

The production presence check passed after commit. Browser submission of the user's existing form was left to the user because automatic approval review blocked the workspace-creation side effect. The subsequent recovery rehearsal now also exercises source submission, a failed queue dispatch, an explicit retry of the saved run, and all draft-preparation stages with the real repository and configured generator. The draft and its suggestion reach ready without provider configuration. Live completion still requires retrying the saved run after deploying the application fix.

## Remaining database rollout work

This is a scoped incident repair, **not a completed database upgrade**. Production is still missing other migrations after the initial onboarding release. A rehearsal of migrations 0058 onward against the original schema stopped at 0073 because the older schema also lacked the composite unique index on `runtime_budget_policies(workspace_id, id)` required by the new foreign key.

Do not blindly run `db:migrate`, stamp the empty ledger as current, or use a destructive schema reset. Reconcile existing schema definitions and constraints against canonical migration history, rehearse that upgrade, assess existing data/backfills, and establish a validated ledger baseline first. Later onboarding analysis and other product features may encounter these outstanding dependencies.

For future deployments, run the read-only prerequisite check against the intended database before sending new users into onboarding:

```sh
node scripts/db-repair-onboarding-prerequisites.mjs --check
```

Supply `DATABASE_URL` securely in the process environment. This presence check does not certify the rest of the schema or provider configuration.

## Dispatch recovery and draft configuration

The next observed production failure committed a source and queued analysis run, but its dispatch intent remained pending with `WORKFLOW_DISPATCH_FAILED`. A second browser click used a new command key and stale revision; refreshing advanced the questionnaire without resubmitting the job. Historical logs contain the HTTP 503 but no underlying exception. Both deployed Workflow queue endpoints passed the SDK health probe; the original submission rejection remains unclassified.

Snapshots now expose a failed pending dispatch. `retry_preparation` validates the current user's exact saved analysis run and redispatches it while preserving questionnaire progress. It does not create another source or analysis run. The browser retains a command key across uncertain responses and offers recovery after reload. Queue failures log only bounded diagnostic labels and server-owned IDs, never exception messages or source content.

Initial profiles and suggestions use the existing local draft path. Provider configuration is now checked when admitted external generation is requested, rather than when constructing the generator. External generation still requires the qualified model configuration and accepted Brand context; this incident fix does not enable or bypass that path. Arabic and English copy describes the draft accurately.

The checked-in public Workflow manifest is stale; the build-generated manifest includes onboarding and its compiled entry point has the expected workflow ID. Do not treat the public file as proof that a production build omitted the workflow.

## SDK compatibility follow-up

After the recovery UI was deployed, five retried submissions on 2026-09-06 logged `WorkflowWorldError` with HTTP 426. The saved dispatch remained pending and the analysis never started. Queue health probes passed because they did not exercise creation of a Workflow run. They are insufficient as an onboarding readiness check.

The application was pinned to `workflow@4.2.0-beta.72`, whose current protocol version is 2. This follow-up pins stable `workflow@4.8.5` and its matching dependencies, whose current protocol version is 3 with CBOR queue transport. No compatibility override or provider-control bypass is introduced. Release reference: https://github.com/vercel/workflow/releases/tag/workflow%404.8.5.

`workflow-runtime-smoke.test.ts` runs the real compiled onboarding workflow through the local queue and Next.js step handlers. It creates only disposable local fixture data and checks the final ready state, persisted profile and suggestion. The test refuses a non-local database or queue server. To run it, build the app, start Next.js with the local rehearsal database and `WORKFLOW_TARGET_WORLD=local`, and give both server and test the same explicit `WORKFLOW_LOCAL_DATA_DIR`. Set `WORKFLOW_LOCAL_BASE_URL=http://127.0.0.1:3157` on the server and `ONBOARDING_WORKFLOW_SMOKE_BASE_URL=http://127.0.0.1:3157` on the test process. Run:

```sh
pnpm test:run src/lib/onboarding/__tests__/workflow-runtime-smoke.test.ts
```

Production verification must exercise a real preparation retry after deployment and observe the run reaching ready. Direct programmatic production triggering was blocked by automatic approval review because it could duplicate a saved run; do not substitute another triggering route without explicit authorization. A successful local smoke or queue health probe does not establish live recovery.
