import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadDotenv } from "dotenv";
import postgres from "postgres";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "../../..");
loadDotenv({ path: join(repoRoot, ".env"), quiet: true });

export async function migrate(connectionString = process.env.DATABASE_URL): Promise<void> {
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
    const existing = await client<
      { name: string }[]
    >`SELECT name FROM _facility_migrations WHERE name = ${"0001_control_plane.sql"}`;
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
