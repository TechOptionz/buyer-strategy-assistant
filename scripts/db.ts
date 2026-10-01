/**
 * Database CLI: `tsx scripts/db.ts migrate|seed|reset`.
 * Uses DATABASE_URL (PostgreSQL) when set, otherwise the local PGlite directory.
 */
import path from "node:path";
import { rmSync } from "node:fs";
import * as schema from "../src/lib/db/schema";
import { seed, seedIfEmpty } from "../src/lib/db/seed";

async function main() {
  const cmd = process.argv[2] ?? "migrate";
  const migrationsFolder = path.join(process.cwd(), "drizzle");
  const url = process.env.DATABASE_URL;
  const pgliteDir = process.env.PGLITE_DIR ?? path.join(process.cwd(), ".data", "pglite");

  if (cmd === "reset") {
    if (url) throw new Error("reset only works on the local PGlite database");
    rmSync(pgliteDir, { recursive: true, force: true });
    console.log("Local database removed.");
  }

  let db;
  let close: () => Promise<void>;
  if (url) {
    const { Pool } = await import("pg");
    const { drizzle } = await import("drizzle-orm/node-postgres");
    const { migrate } = await import("drizzle-orm/node-postgres/migrator");
    const pool = new Pool({ connectionString: url, ssl: url.includes("localhost") || url.includes("sslmode=disable") ? undefined : { rejectUnauthorized: false } });
    db = drizzle(pool, { schema });
    await migrate(db, { migrationsFolder });
    close = () => pool.end();
  } else {
    const { PGlite } = await import("@electric-sql/pglite");
    const { drizzle } = await import("drizzle-orm/pglite");
    const { migrate } = await import("drizzle-orm/pglite/migrator");
    const { mkdirSync } = await import("node:fs");
    mkdirSync(path.dirname(pgliteDir), { recursive: true });
    const client = new PGlite(pgliteDir);
    const d = drizzle(client, { schema });
    await migrate(d, { migrationsFolder });
    db = d as unknown as typeof db;
    close = () => client.close();
  }
  console.log("Migrations applied.");
  if (cmd === "seed" || cmd === "reset") {
    const seeded = cmd === "reset" ? (await seed(db as never), true) : await seedIfEmpty(db as never);
    console.log(seeded ? "Fictional seed data created." : "Database already has data; seed skipped.");
  }
  await close();
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
