// src/migrate.ts
import { readFile } from "fs/promises";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { config as loadDotenv } from "dotenv";
import postgres from "postgres";
var here = dirname(fileURLToPath(import.meta.url));
var repoRoot = join(here, "../../..");
loadDotenv({ path: join(repoRoot, ".env"), quiet: true });
async function migrate(connectionString = process.env.DATABASE_URL) {
  if (!connectionString) {
    throw new Error("DATABASE_URL is required");
  }
  const client = postgres(connectionString, { max: 1 });
  try {
    await client`CREATE TABLE IF NOT EXISTS _facility_migrations (
      name text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )`;
    const migrationsDir = join(here, "..", "migrations");
    const sql = await readFile(join(migrationsDir, "0001_control_plane.sql"), "utf8");
    const existing = await client`SELECT name FROM _facility_migrations WHERE name = ${"0001_control_plane.sql"}`;
    if (existing.length === 0) {
      await client.begin(async (tx) => {
        await tx.unsafe(sql);
        await tx`INSERT INTO _facility_migrations (name) VALUES (${"0001_control_plane.sql"})`;
      });
      console.log("applied 0001_control_plane.sql");
    } else {
      console.log("0001_control_plane.sql already applied");
    }
  } finally {
    await client.end();
  }
}
if (import.meta.url === `file://${process.argv[1]}`) {
  migrate().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

export {
  migrate
};
