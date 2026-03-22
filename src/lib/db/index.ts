import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

type DbClient = ReturnType<typeof drizzle<typeof schema>>;

const globalDb = globalThis as typeof globalThis & {
  __nodeBananaPgPool?: Pool;
  __nodeBananaDb?: DbClient;
};

export function isDatabaseConfigured(): boolean {
  return Boolean(process.env.DATABASE_URL);
}

export function getDb(): DbClient {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error(
      "DATABASE_URL is not configured. Set it in .env.local to enable Postgres-backed persistence.",
    );
  }

  if (!globalDb.__nodeBananaPgPool) {
    globalDb.__nodeBananaPgPool = new Pool({
      connectionString: databaseUrl,
      max: 20,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 10_000,
    });
  }

  if (!globalDb.__nodeBananaDb) {
    globalDb.__nodeBananaDb = drizzle(globalDb.__nodeBananaPgPool, {
      schema,
    });
  }

  return globalDb.__nodeBananaDb;
}

export function getDbOrNull(): DbClient | null {
  if (!isDatabaseConfigured()) return null;
  return getDb();
}

export { schema };

