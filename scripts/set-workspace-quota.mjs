import { Pool } from "pg";

const databaseUrl =
  process.env.DATABASE_URL ||
  "postgresql://postgres:postgres@localhost:5432/node_banana";

const BYTE_MULTIPLIER = {
  b: 1,
  kb: 1024,
  mb: 1024 ** 2,
  gb: 1024 ** 3,
  tb: 1024 ** 4,
};

function parseQuotaBytes(input) {
  if (typeof input !== "string" || !input.trim()) {
    throw new Error("quota is required (examples: 10737418240, 10gb, 512mb)");
  }

  const normalized = input.trim().toLowerCase();
  const match = normalized.match(/^(\d+)(b|kb|mb|gb|tb)?$/);
  if (!match) {
    throw new Error(`Invalid quota value: ${input}`);
  }

  const amount = Number(match[1]);
  const unit = match[2] || "b";
  const multiplier = BYTE_MULTIPLIER[unit];
  const quotaBytes = amount * multiplier;

  if (!Number.isFinite(quotaBytes) || quotaBytes < 0) {
    throw new Error(`Invalid quota bytes: ${quotaBytes}`);
  }

  return quotaBytes;
}

async function main() {
  const workspaceId = process.argv[2];
  const quotaInput = process.argv[3];

  if (!workspaceId || !workspaceId.trim()) {
    console.error("Usage: node scripts/set-workspace-quota.mjs <workspaceId> <quota>");
    process.exitCode = 1;
    return;
  }

  const quotaBytes = parseQuotaBytes(quotaInput);
  const pool = new Pool({ connectionString: databaseUrl });
  const client = await pool.connect();

  try {
    const workspaceResult = await client.query(
      `SELECT id FROM workspaces WHERE id = $1 LIMIT 1`,
      [workspaceId],
    );

    if (workspaceResult.rowCount === 0) {
      throw new Error(`Workspace not found: ${workspaceId}`);
    }

    await client.query(
      `
        INSERT INTO workspace_storage_limits (workspace_id, quota_bytes, updated_at)
        VALUES ($1, $2, NOW())
        ON CONFLICT (workspace_id)
        DO UPDATE SET
          quota_bytes = EXCLUDED.quota_bytes,
          updated_at = NOW()
      `,
      [workspaceId, quotaBytes],
    );

    console.log(
      `Updated workspace quota: workspace_id=${workspaceId} quota_bytes=${quotaBytes}`,
    );
  } finally {
    client.release();
    await pool.end();
  }
}

await main();
