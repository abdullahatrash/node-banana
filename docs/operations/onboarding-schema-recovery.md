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

The production presence check passed after commit. Browser submission of the user's existing form was left to the user because automatic approval review blocked the workspace-creation side effect. Completing the remaining onboarding stages has not been verified.

## Remaining database rollout work

This is a scoped incident repair, **not a completed database upgrade**. Production is still missing other migrations after the initial onboarding release. A rehearsal of migrations 0058 onward against the original schema stopped at 0073 because the older schema also lacked the composite unique index on `runtime_budget_policies(workspace_id, id)` required by the new foreign key.

Do not blindly run `db:migrate`, stamp the empty ledger as current, or use a destructive schema reset. Reconcile existing schema definitions and constraints against canonical migration history, rehearse that upgrade, assess existing data/backfills, and establish a validated ledger baseline first. Later onboarding analysis and other product features may encounter these outstanding dependencies.

For future deployments, run the read-only prerequisite check against the intended database before sending new users into onboarding:

```sh
node scripts/db-repair-onboarding-prerequisites.mjs --check
```

Supply `DATABASE_URL` securely in the process environment. This presence check does not certify the rest of the schema or provider configuration.
