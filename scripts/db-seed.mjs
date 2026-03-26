import { Pool } from "pg";
import { hashPassword } from "better-auth/crypto";

const databaseUrl =
  process.env.DATABASE_URL ||
  "postgresql://postgres:postgres@localhost:5432/node_banana";
const DEFAULT_WORKSPACE_QUOTA_BYTES = 10 * 1024 * 1024 * 1024;

const seedUsers = [
  {
    id: "seed_user_alice",
    name: "Alice Admin",
    email: "alice@nodebanana.dev",
    password: "Password123!",
    workspace: {
      id: "seed_ws_alice",
      name: "Alice Studio",
      slug: "alice-studio",
    },
  },
  {
    id: "seed_user_bob",
    name: "Bob Builder",
    email: "bob@nodebanana.dev",
    password: "Password123!",
    workspace: {
      id: "seed_ws_bob",
      name: "Bob Studio",
      slug: "bob-studio",
    },
  },
  {
    id: "seed_user_chloe",
    name: "Chloe Creator",
    email: "chloe@nodebanana.dev",
    password: "Password123!",
    workspace: {
      id: "seed_ws_chloe",
      name: "Chloe Studio",
      slug: "chloe-studio",
    },
  },
];

function organizationIdForWorkspace(workspaceId) {
  return `org_${workspaceId}`;
}

function organizationMemberId(workspaceId, userId) {
  return `mbr_${workspaceId}_${userId}`;
}

async function ensureUser(client, seedUser) {
  const existingUserResult = await client.query(
    `SELECT id FROM "user" WHERE email = $1 LIMIT 1`,
    [seedUser.email],
  );

  const userId = existingUserResult.rows[0]?.id || seedUser.id;

  if (existingUserResult.rowCount === 0) {
    await client.query(
      `
        INSERT INTO "user" (
          id,
          name,
          email,
          email_verified,
          created_at,
          updated_at
        )
        VALUES ($1, $2, $3, $4, NOW(), NOW())
      `,
      [userId, seedUser.name, seedUser.email, true],
    );
  } else {
    await client.query(
      `
        UPDATE "user"
        SET
          name = $2,
          email_verified = $3,
          updated_at = NOW()
        WHERE id = $1
      `,
      [userId, seedUser.name, true],
    );
  }

  const passwordHash = await hashPassword(seedUser.password);

  await client.query(
    `
      INSERT INTO account (
        id,
        account_id,
        provider_id,
        user_id,
        password,
        created_at,
        updated_at
      )
      VALUES ($1, $2, 'credential', $2, $3, NOW(), NOW())
      ON CONFLICT (provider_id, account_id)
      DO UPDATE SET
        user_id = EXCLUDED.user_id,
        password = EXCLUDED.password,
        updated_at = NOW()
    `,
    [`acct_${userId}`, userId, passwordHash],
  );

  const workspaceResult = await client.query(
    `
      INSERT INTO workspaces (
        id,
        name,
        slug,
        owner_user_id,
        created_at,
        updated_at,
        deleted_at
      )
      VALUES ($1, $2, $3, $4, NOW(), NOW(), NULL)
      ON CONFLICT (slug)
      DO UPDATE SET
        name = EXCLUDED.name,
        owner_user_id = EXCLUDED.owner_user_id,
        updated_at = NOW(),
        deleted_at = NULL
      RETURNING id
    `,
    [
      seedUser.workspace.id,
      seedUser.workspace.name,
      seedUser.workspace.slug,
      userId,
    ],
  );

  const workspaceId = workspaceResult.rows[0]?.id || seedUser.workspace.id;

  await client.query(
    `
      INSERT INTO workspace_storage_limits (
        workspace_id,
        quota_bytes,
        updated_at
      )
      VALUES ($1, $2, NOW())
      ON CONFLICT (workspace_id)
      DO UPDATE SET
        updated_at = NOW()
    `,
    [workspaceId, DEFAULT_WORKSPACE_QUOTA_BYTES],
  );

  await client.query(
    `
      INSERT INTO workspace_members (
        workspace_id,
        user_id,
        role,
        created_at,
        updated_at
      )
      VALUES ($1, $2, 'owner', NOW(), NOW())
      ON CONFLICT (workspace_id, user_id)
      DO UPDATE SET
        role = 'owner',
        updated_at = NOW()
    `,
    [workspaceId, userId],
  );

  const organizationId = organizationIdForWorkspace(workspaceId);

  await client.query(
    `
      INSERT INTO organization (
        id,
        name,
        slug,
        metadata,
        created_at
      )
      VALUES ($1, $2, $3, $4, NOW())
      ON CONFLICT (id)
      DO UPDATE SET
        name = EXCLUDED.name,
        slug = EXCLUDED.slug,
        metadata = EXCLUDED.metadata
    `,
    [
      organizationId,
      seedUser.workspace.name,
      seedUser.workspace.slug,
      null,
    ],
  );

  await client.query(
    `
      INSERT INTO workspace_settings (
        workspace_id,
        organization_id,
        plan_tier,
        created_at,
        updated_at
      )
      VALUES ($1, $2, 'free', NOW(), NOW())
      ON CONFLICT (workspace_id)
      DO UPDATE SET
        organization_id = EXCLUDED.organization_id,
        updated_at = NOW()
    `,
    [workspaceId, organizationId],
  );

  await client.query(
    `
      INSERT INTO member (
        id,
        organization_id,
        user_id,
        role,
        created_at
      )
      VALUES ($1, $2, $3, 'owner', NOW())
      ON CONFLICT (organization_id, user_id)
      DO UPDATE SET
        role = 'owner'
    `,
    [organizationMemberId(workspaceId, userId), organizationId, userId],
  );

  return {
    userId,
    email: seedUser.email,
    password: seedUser.password,
    workspaceId,
    workspaceSlug: seedUser.workspace.slug,
  };
}

async function main() {
  const pool = new Pool({
    connectionString: databaseUrl,
  });

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const results = [];
    for (const seedUser of seedUsers) {
      const result = await ensureUser(client, seedUser);
      results.push(result);
    }

    await client.query("COMMIT");

    console.log("Database seed complete.");
    console.log("Seeded users:");
    for (const result of results) {
      console.log(
        `- ${result.email} / ${result.password} (workspace: ${result.workspaceSlug})`,
      );
    }
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Database seed failed:", error);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

await main();
