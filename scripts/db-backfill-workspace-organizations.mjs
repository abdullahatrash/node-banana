import { Pool } from "pg";

const databaseUrl =
  process.env.DATABASE_URL ||
  "postgresql://postgres:postgres@localhost:5432/node_banana";

function organizationIdForWorkspace(workspaceId) {
  return `org_${workspaceId}`;
}

function organizationMemberId(workspaceId, userId) {
  return `mbr_${workspaceId}_${userId}`;
}

function toOrganizationRole(role) {
  if (role === "owner" || role === "admin") return role;
  return "member";
}

async function main() {
  const pool = new Pool({ connectionString: databaseUrl });
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const { rows: workspaces } = await client.query(
      `
      SELECT id, name, slug, brand_kit
      FROM workspaces
      WHERE deleted_at IS NULL
      ORDER BY created_at ASC
      `,
    );

    let mappedWorkspaces = 0;
    let mappedMembers = 0;

    for (const workspace of workspaces) {
      const organizationId = organizationIdForWorkspace(workspace.id);

      await client.query(
        `
        INSERT INTO organization (id, name, slug, metadata, created_at)
        VALUES ($1, $2, $3, $4, NOW())
        ON CONFLICT (id)
        DO UPDATE SET
          name = EXCLUDED.name,
          slug = EXCLUDED.slug,
          metadata = EXCLUDED.metadata
        `,
        [
          organizationId,
          workspace.name,
          workspace.slug,
          workspace.brand_kit
            ? JSON.stringify({ brandKit: workspace.brand_kit })
            : null,
        ],
      );

      await client.query(
        `
        INSERT INTO workspace_settings (
          workspace_id,
          organization_id,
          plan_tier,
          brand_kit,
          created_at,
          updated_at
        )
        VALUES ($1, $2, 'free', $3, NOW(), NOW())
        ON CONFLICT (workspace_id)
        DO UPDATE SET
          organization_id = EXCLUDED.organization_id,
          brand_kit = EXCLUDED.brand_kit,
          updated_at = NOW()
        `,
        [workspace.id, organizationId, workspace.brand_kit],
      );

      mappedWorkspaces += 1;

      const { rows: members } = await client.query(
        `
        SELECT user_id, role
        FROM workspace_members
        WHERE workspace_id = $1
        `,
        [workspace.id],
      );

      for (const membership of members) {
        await client.query(
          `
          INSERT INTO member (id, organization_id, user_id, role, created_at)
          VALUES ($1, $2, $3, $4, NOW())
          ON CONFLICT (organization_id, user_id)
          DO UPDATE SET
            role = EXCLUDED.role
          `,
          [
            organizationMemberId(workspace.id, membership.user_id),
            organizationId,
            membership.user_id,
            toOrganizationRole(membership.role),
          ],
        );
        mappedMembers += 1;
      }
    }

    await client.query("COMMIT");

    console.log("Workspace -> organization backfill complete.");
    console.log(`Mapped workspaces: ${mappedWorkspaces}`);
    console.log(`Mapped memberships: ${mappedMembers}`);
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Backfill failed:", error);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

await main();
