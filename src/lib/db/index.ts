import "server-only";
import path from "node:path";
import { drizzle as drizzlePg, type NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "./schema";

export type DB = NodePgDatabase<typeof schema>;

const globalForDb = globalThis as unknown as { __db?: Promise<DB> };

/**
 * Database connection.
 * - DATABASE_URL set → PostgreSQL via node-postgres (production / Vercel).
 * - Otherwise → embedded PGlite (real Postgres compiled to WASM) persisted under PGLITE_DIR,
 *   migrated automatically. Local development only.
 */
async function connect(): Promise<DB> {
  const url = process.env.DATABASE_URL;
  if (url) {
    const { Pool } = await import("pg");
    const pool = new Pool({
      connectionString: url,
      max: Number(process.env.DATABASE_POOL_MAX ?? 5),
      ssl: url.includes("sslmode=disable") || url.includes("localhost") ? undefined : { rejectUnauthorized: false },
    });
    return drizzlePg(pool, { schema });
  }
  if (process.env.NODE_ENV === "production" && process.env.ALLOW_EPHEMERAL_DB !== "true") {
    throw new Error("DATABASE_URL is required in production (set ALLOW_EPHEMERAL_DB=true only for a labelled demo).");
  }
  const { PGlite } = await import("@electric-sql/pglite");
  const { drizzle: drizzlePglite } = await import("drizzle-orm/pglite");
  const { migrate } = await import("drizzle-orm/pglite/migrator");
  const dir = process.env.PGLITE_DIR ?? (process.env.VERCEL ? "/tmp/pglite" : path.join(process.cwd(), ".data", "pglite"));
  const { mkdirSync } = await import("node:fs");
  mkdirSync(path.dirname(dir), { recursive: true });
  const client = new PGlite(dir);
  const db = drizzlePglite(client, { schema });
  await migrate(db, { migrationsFolder: path.join(process.cwd(), "drizzle") });
  if (process.env.AUTO_SEED === "true") {
    const { seedIfEmpty } = await import("./seed");
    await seedIfEmpty(db as unknown as DB);
  }
  return db as unknown as DB;
}

export function getDb(): Promise<DB> {
  if (!globalForDb.__db) {
    globalForDb.__db = connect().catch((e) => {
      globalForDb.__db = undefined;
      throw e;
    });
  }
  return globalForDb.__db;
}

export { schema };
