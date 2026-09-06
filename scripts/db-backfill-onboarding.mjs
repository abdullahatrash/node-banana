import { Pool } from "pg";

const databaseUrl =
  process.env.DATABASE_URL ||
  "postgresql://postgres:postgres@localhost:5432/node_banana";
const dryRun = process.argv.includes("--dry-run");

async function main() {
  const pool = new Pool({ connectionString: databaseUrl });
  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    const { rows: candidates } = await client.query(`
      SELECT DISTINCT ON (wm.user_id)
        wm.user_id,
        wm.workspace_id
      FROM workspace_members wm
      INNER JOIN workspaces w ON w.id = wm.workspace_id
      WHERE w.deleted_at IS NULL
        AND NOT EXISTS (
          SELECT 1
          FROM onboarding_sessions os
          WHERE os.user_id = wm.user_id
        )
      ORDER BY
        wm.user_id,
        CASE WHEN wm.role = 'owner' THEN 0 ELSE 1 END,
        wm.created_at ASC
    `);

    if (!dryRun && candidates.length > 0) {
      await client.query(
        `
        INSERT INTO onboarding_sessions (
          id,
          user_id,
          workspace_id,
          status,
          current_step,
          answers,
          content_language,
          revision,
          completed_at,
          created_at,
          updated_at
        )
        SELECT
          'onb_legacy_' || md5(candidate.user_id),
          candidate.user_id,
          candidate.workspace_id,
          'completed_legacy',
          'education',
          '{"schemaVersion":1}'::jsonb,
          COALESCE(ws.default_content_language, 'ar'),
          1,
          NOW(),
          NOW(),
          NOW()
        FROM unnest($1::text[], $2::text[]) AS candidate(user_id, workspace_id)
        LEFT JOIN workspace_settings ws
          ON ws.workspace_id = candidate.workspace_id
        ON CONFLICT (user_id) DO NOTHING
        `,
        [
          candidates.map((candidate) => candidate.user_id),
          candidates.map((candidate) => candidate.workspace_id),
        ],
      );

      await client.query(
        `
        INSERT INTO user_preferences (
          user_id,
          interface_locale,
          created_at,
          updated_at
        )
        SELECT user_id, 'ar', NOW(), NOW()
        FROM unnest($1::text[]) AS candidate(user_id)
        ON CONFLICT (user_id) DO NOTHING
        `,
        [candidates.map((candidate) => candidate.user_id)],
      );
    }

    if (dryRun) {
      await client.query("ROLLBACK");
    } else {
      await client.query("COMMIT");
    }

    console.log(
      `${dryRun ? "Would mark" : "Marked"} ${candidates.length} existing users as completed_legacy.`,
    );
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Onboarding backfill failed:", error);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

await main();
