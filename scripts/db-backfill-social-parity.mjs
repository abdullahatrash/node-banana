import { Pool } from "pg";

const databaseUrl =
  process.env.DATABASE_URL ||
  "postgresql://postgres:postgres@localhost:5432/node_banana";

const DRY_RUN = process.argv.includes("--dry-run");

function logStep(name, count, skipped = false) {
  const prefix = skipped ? "[skip]" : DRY_RUN ? "[dry-run]" : "[apply]";
  console.log(`${prefix} ${name}: ${count}`);
}

async function tableExists(client, tableName) {
  const { rows } = await client.query(
    `SELECT to_regclass($1) AS exists`,
    [`public.${tableName}`],
  );
  return Boolean(rows[0]?.exists);
}

async function countQuery(client, query, params = []) {
  const { rows } = await client.query(query, params);
  return Number(rows[0]?.count ?? 0);
}

async function applyQuery(client, query, params = []) {
  const { rows } = await client.query(query, params);
  return Number(rows[0]?.count ?? 0);
}

async function main() {
  const pool = new Pool({ connectionString: databaseUrl });
  const client = await pool.connect();

  try {
    if (!DRY_RUN) {
      await client.query("BEGIN");
    }

    if (await tableExists(client, "social_posts")) {
      const backfillKindCount = DRY_RUN
        ? await countQuery(
            client,
            `SELECT COUNT(*)::int AS count
             FROM social_posts
             WHERE kind IS NULL`,
          )
        : await applyQuery(
            client,
            `WITH changed AS (
               UPDATE social_posts
               SET kind = 'post', updated_at = NOW()
               WHERE kind IS NULL
               RETURNING 1
             )
             SELECT COUNT(*)::int AS count FROM changed`,
          );
      logStep("social_posts.kind backfill", backfillKindCount);

      const backfillTriggerSourceChainCount = DRY_RUN
        ? await countQuery(
            client,
            `SELECT COUNT(*)::int AS count
             FROM social_posts
             WHERE trigger_source IS NULL
               AND kind IN ('chain_root', 'chain_child')`,
          )
        : await applyQuery(
            client,
            `WITH changed AS (
               UPDATE social_posts
               SET trigger_source = 'chain', updated_at = NOW()
               WHERE trigger_source IS NULL
                 AND kind IN ('chain_root', 'chain_child')
               RETURNING 1
             )
             SELECT COUNT(*)::int AS count FROM changed`,
          );
      logStep(
        "social_posts.trigger_source backfill (chain)",
        backfillTriggerSourceChainCount,
      );

      const backfillTriggerSourceAutomationCount = DRY_RUN
        ? await countQuery(
            client,
            `SELECT COUNT(*)::int AS count
             FROM social_posts
             WHERE trigger_source IS NULL
               AND platform_settings -> 'automation' IS NOT NULL`,
          )
        : await applyQuery(
            client,
            `WITH changed AS (
               UPDATE social_posts
               SET trigger_source = 'automation', updated_at = NOW()
               WHERE trigger_source IS NULL
                 AND platform_settings -> 'automation' IS NOT NULL
               RETURNING 1
             )
             SELECT COUNT(*)::int AS count FROM changed`,
          );
      logStep(
        "social_posts.trigger_source backfill (automation)",
        backfillTriggerSourceAutomationCount,
      );

      const backfillTriggerSourceManualCount = DRY_RUN
        ? await countQuery(
            client,
            `SELECT COUNT(*)::int AS count
             FROM social_posts
             WHERE trigger_source IS NULL`,
          )
        : await applyQuery(
            client,
            `WITH changed AS (
               UPDATE social_posts
               SET trigger_source = 'manual', updated_at = NOW()
               WHERE trigger_source IS NULL
               RETURNING 1
             )
             SELECT COUNT(*)::int AS count FROM changed`,
          );
      logStep(
        "social_posts.trigger_source backfill (manual)",
        backfillTriggerSourceManualCount,
      );

      const backfillDispatchQueuedCount = DRY_RUN
        ? await countQuery(
            client,
            `SELECT COUNT(*)::int AS count
             FROM social_posts
             WHERE status = 'queued'
               AND dispatch_status IS NULL`,
          )
        : await applyQuery(
            client,
            `WITH changed AS (
               UPDATE social_posts
               SET dispatch_status = 'pending',
                   next_dispatch_at = COALESCE(next_dispatch_at, scheduled_at),
                   updated_at = NOW()
               WHERE status = 'queued'
                 AND dispatch_status IS NULL
               RETURNING 1
             )
             SELECT COUNT(*)::int AS count FROM changed`,
          );
      logStep("social_posts.dispatch_status backfill (queued)", backfillDispatchQueuedCount);

      const backfillDispatchPublishingCount = DRY_RUN
        ? await countQuery(
            client,
            `SELECT COUNT(*)::int AS count
             FROM social_posts
             WHERE status IN ('publishing', 'published')
               AND dispatch_status IS NULL`,
          )
        : await applyQuery(
            client,
            `WITH changed AS (
               UPDATE social_posts
               SET dispatch_status = 'dispatched',
                   updated_at = NOW()
               WHERE status IN ('publishing', 'published')
                 AND dispatch_status IS NULL
               RETURNING 1
             )
             SELECT COUNT(*)::int AS count FROM changed`,
          );
      logStep(
        "social_posts.dispatch_status backfill (publishing/published)",
        backfillDispatchPublishingCount,
      );

      const backfillDispatchFailedCount = DRY_RUN
        ? await countQuery(
            client,
            `SELECT COUNT(*)::int AS count
             FROM social_posts
             WHERE status = 'failed'
               AND dispatch_status IS NULL`,
          )
        : await applyQuery(
            client,
            `WITH changed AS (
               UPDATE social_posts
               SET dispatch_status = 'failed',
                   updated_at = NOW()
               WHERE status = 'failed'
                 AND dispatch_status IS NULL
               RETURNING 1
             )
             SELECT COUNT(*)::int AS count FROM changed`,
          );
      logStep("social_posts.dispatch_status backfill (failed)", backfillDispatchFailedCount);
    } else {
      logStep("social_posts backfills", 0, true);
    }

    if (await tableExists(client, "social_event_reads")) {
      const readBackfillCount = DRY_RUN
        ? await countQuery(
            client,
            `SELECT COUNT(*)::int AS count
             FROM social_events e
             WHERE e.read_at IS NOT NULL
               AND e.created_by_user_id IS NOT NULL
               AND NOT EXISTS (
                 SELECT 1
                 FROM social_event_reads r
                 WHERE r.event_id = e.id
                   AND r.user_id = e.created_by_user_id
               )`,
          )
        : await applyQuery(
            client,
            `WITH inserted AS (
               INSERT INTO social_event_reads (
                 event_id,
                 workspace_id,
                 user_id,
                 read_at,
                 created_at
               )
               SELECT
                 e.id,
                 e.workspace_id,
                 e.created_by_user_id,
                 COALESCE(e.read_at, e.created_at),
                 COALESCE(e.read_at, e.created_at)
               FROM social_events e
               WHERE e.read_at IS NOT NULL
                 AND e.created_by_user_id IS NOT NULL
               ON CONFLICT (event_id, user_id) DO NOTHING
               RETURNING 1
             )
             SELECT COUNT(*)::int AS count FROM inserted`,
          );
      logStep("social_event_reads backfill", readBackfillCount);
    } else {
      logStep("social_event_reads backfill", 0, true);
    }

    if (await tableExists(client, "social_webhook_subscriptions")) {
      const webhookSubscriptionBackfillCount = DRY_RUN
        ? await countQuery(
            client,
            `SELECT COUNT(*)::int AS count
             FROM social_webhooks w
             WHERE NOT EXISTS (
               SELECT 1
               FROM social_webhook_subscriptions s
               WHERE s.webhook_id = w.id
             )`,
          )
        : await applyQuery(
            client,
            `WITH inserted AS (
               INSERT INTO social_webhook_subscriptions (
                 id,
                 workspace_id,
                 webhook_id,
                 name,
                 enabled,
                 filters,
                 created_by_user_id,
                 created_at,
                 updated_at
               )
               SELECT
                 'swhsub_' || substr(md5(w.id || ':default'), 1, 24),
                 w.workspace_id,
                 w.id,
                 'Default subscription',
                 true,
                 NULL,
                 w.created_by_user_id,
                 NOW(),
                 NOW()
               FROM social_webhooks w
               WHERE NOT EXISTS (
                 SELECT 1
                 FROM social_webhook_subscriptions s
                 WHERE s.webhook_id = w.id
               )
               ON CONFLICT (id) DO NOTHING
               RETURNING 1
             )
             SELECT COUNT(*)::int AS count FROM inserted`,
          );
      logStep(
        "social_webhook_subscriptions default backfill",
        webhookSubscriptionBackfillCount,
      );
    } else {
      logStep("social_webhook_subscriptions backfill", 0, true);
    }

    if (await tableExists(client, "social_automation_tasks")) {
      const runIndexNormalizationCount = DRY_RUN
        ? await countQuery(
            client,
            `SELECT COUNT(*)::int AS count
             FROM social_automation_tasks
             WHERE run_index < 1`,
          )
        : await applyQuery(
            client,
            `WITH changed AS (
               UPDATE social_automation_tasks
               SET run_index = 1,
                   updated_at = NOW()
               WHERE run_index < 1
               RETURNING 1
             )
             SELECT COUNT(*)::int AS count FROM changed`,
          );
      logStep("social_automation_tasks.run_index normalization", runIndexNormalizationCount);

      const deterministicTaskKeyCount = DRY_RUN
        ? await countQuery(
            client,
            `SELECT COUNT(*)::int AS count
             FROM social_automation_tasks t
             WHERE (t.task_key IS NULL OR t.task_key !~ '^[^:]+:[^:]+:[0-9]+$')
               AND NOT EXISTS (
                 SELECT 1
                 FROM social_automation_tasks x
                 WHERE x.id <> t.id
                   AND x.task_key = CONCAT(t.workspace_id, ':', t.rule_id, ':', t.run_index)
               )`,
          )
        : await applyQuery(
            client,
            `WITH changed AS (
               UPDATE social_automation_tasks t
               SET task_key = CONCAT(t.workspace_id, ':', t.rule_id, ':', t.run_index),
                   updated_at = NOW()
               WHERE (t.task_key IS NULL OR t.task_key !~ '^[^:]+:[^:]+:[0-9]+$')
                 AND NOT EXISTS (
                   SELECT 1
                   FROM social_automation_tasks x
                   WHERE x.id <> t.id
                     AND x.task_key = CONCAT(t.workspace_id, ':', t.rule_id, ':', t.run_index)
                 )
               RETURNING 1
             )
             SELECT COUNT(*)::int AS count FROM changed`,
          );
      logStep("social_automation_tasks.task_key deterministic backfill", deterministicTaskKeyCount);

      const fallbackTaskKeyCount = DRY_RUN
        ? await countQuery(
            client,
            `SELECT COUNT(*)::int AS count
             FROM social_automation_tasks
             WHERE task_key IS NULL`,
          )
        : await applyQuery(
            client,
            `WITH changed AS (
               UPDATE social_automation_tasks
               SET task_key = CONCAT(workspace_id, ':', rule_id, ':', run_index, ':', id),
                   updated_at = NOW()
               WHERE task_key IS NULL
               RETURNING 1
             )
             SELECT COUNT(*)::int AS count FROM changed`,
          );
      logStep("social_automation_tasks.task_key fallback fill", fallbackTaskKeyCount);
    } else {
      logStep("social_automation_tasks backfills", 0, true);
    }

    if (!DRY_RUN) {
      await client.query("COMMIT");
      console.log("Social parity backfill complete.");
    } else {
      console.log("Dry-run complete. No changes were written.");
    }
  } catch (error) {
    if (!DRY_RUN) {
      await client.query("ROLLBACK");
    }
    console.error("Backfill failed:", error);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

await main();
