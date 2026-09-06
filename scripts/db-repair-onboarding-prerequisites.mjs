import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";

// Incident recovery for a database provisioned through onboarding v1 without
// its migration ledger. This deliberately does not baseline the global ledger.
const migration = (name) => readFileSync(fileURLToPath(new URL(`../drizzle/${name}.sql`, import.meta.url)), "utf8");
const billing = migration("0090_billing_credits_referrals");
const tables = [...billing.matchAll(/CREATE TABLE "([a-z_]+)"/g)].map((match) => match[1]);
tables.push("workspace_interface_locale_preferences");
const columns = ["default_interface_locale", "scheduling_timezone", "scheduling_week_start", "content_market"];
const fragments = [
  billing,
  migration("0102_workspace_calendar_preferences"),
  migration("0105_workspace_interface_locales"),
  // Only the plan catalog is required; credit-pack checkout is outside this repair.
  migration("0116_default_commercial_catalog").split("--> statement-breakpoint")[0],
  // Define activation for newly created workspaces; don't grant all existing ones credits.
  migration("0118_workspace_free_plan_activation").split("--> statement-breakpoint")[0],
  migration("0126_workspace_preferences"),
];

export async function inspectOnboardingPrerequisites(client) {
  const relations = await client.query("select name, to_regclass('public.' || name) is not null as present from unnest($1::text[]) name", [tables]);
  const fields = await client.query("select column_name from information_schema.columns where table_schema='public' and table_name='workspace_settings' and column_name=any($1::text[])", [columns]);
  const activation = await client.query("select to_regprocedure('public.ensure_workspace_free_plan_v1(text,timestamptz)') is not null as present");
  const existingColumns = new Set(fields.rows.map((row) => row.column_name));
  return {
    missingTables: relations.rows.filter((row) => !row.present).map((row) => row.name),
    missingColumns: columns.filter((name) => !existingColumns.has(name)),
    missingActivationFunction: !activation.rows[0].present,
  };
}

export async function repairOnboardingPrerequisites(pool, apply = false) {
  const client = await pool.connect();
  try {
    await client.query(apply ? "BEGIN" : "BEGIN READ ONLY");
    await client.query("SET LOCAL lock_timeout = '5s'");
    await client.query("SET LOCAL statement_timeout = '30s'");
    if (apply) await client.query("select pg_advisory_xact_lock(186105118)");
    const before = await inspectOnboardingPrerequisites(client);
    const ready = before.missingTables.length === 0 && before.missingColumns.length === 0 && !before.missingActivationFunction;
    if (!apply || ready) {
      await client.query("ROLLBACK");
      return { ready, applied: false, ...before };
    }
    // Fail closed on partial or unexpected state. Never overwrite a table,
    // function, existing catalog, or existing workspace preference column.
    if (before.missingTables.length !== tables.length || before.missingColumns.length !== columns.length || !before.missingActivationFunction) {
      throw new Error("PARTIAL_SCHEMA_REQUIRES_MANUAL_REVIEW");
    }
    for (const fragment of fragments) {
      for (const statement of fragment.split("--> statement-breakpoint")) {
        if (statement.trim()) await client.query(statement);
      }
    }
    const after = await inspectOnboardingPrerequisites(client);
    if (after.missingTables.length || after.missingColumns.length || after.missingActivationFunction) throw new Error("ONBOARDING_PREREQUISITES_INCOMPLETE");
    await client.query("COMMIT");
    return { ready: true, applied: true, ...after };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.some((arg) => !["--check", "--apply"].includes(arg)) || args.length > 1) throw new Error("Use --check (default) or --apply");
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required; there is no default database");
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1, connectionTimeoutMillis: 10000 });
  try {
    const result = await repairOnboardingPrerequisites(pool, args.includes("--apply"));
    console.log(JSON.stringify(result, null, 2));
    if (!result.ready) process.exitCode = 1;
  } catch (error) {
    console.error({ code: error.code, message: error.message });
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}
