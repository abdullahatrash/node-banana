import { Pool } from "pg";
import { hashPassword } from "better-auth/crypto";

const databaseUrl =
  process.env.DATABASE_URL ||
  "postgresql://postgres:postgres@localhost:5432/node_banana";

const args = process.argv.slice(2).filter((arg) => arg !== "--");
const [emailArg, passwordArg] = args;
const email = emailArg?.trim().toLowerCase();
const password = passwordArg ?? "";

if (!email || !password) {
  console.error(
    "Usage: node scripts/db-set-password.mjs <email> <newPassword>",
  );
  process.exit(1);
}

async function main() {
  const pool = new Pool({
    connectionString: databaseUrl,
  });

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const userResult = await client.query(
      `
        SELECT id, email
        FROM "user"
        WHERE lower(email) = lower($1)
        LIMIT 1
      `,
      [email],
    );

    if (userResult.rowCount === 0) {
      throw new Error(`User not found for email: ${email}`);
    }

    const user = userResult.rows[0];
    const passwordHash = await hashPassword(password);

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
      [`acct_${user.id}`, user.id, passwordHash],
    );

    await client.query("COMMIT");

    console.log(`Password updated for ${user.email}`);
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Failed to update password:", error);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

await main();
