import "dotenv/config";
import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import pg from "pg";

const { Pool } = pg;
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required for migrations");

const pool = new Pool({ connectionString: databaseUrl, max: 1, application_name: "lira-migrator" });
const dir = path.resolve("db/migrations");
const lockId = 781923441;

try {
  const client = await pool.connect();
  try {
    await client.query("select pg_advisory_lock($1)", [lockId]);
    await client.query(`create table if not exists lira_schema_migrations (
      filename text primary key,
      checksum varchar(64) not null,
      applied_at timestamptz not null default now()
    )`);
    const files = (await readdir(dir)).filter((name) => /^\d+.*\.sql$/.test(name)).sort();
    for (const filename of files) {
      const sql = await readFile(path.join(dir, filename), "utf8");
      const checksum = createHash("sha256").update(sql).digest("hex");
      const existing = await client.query("select checksum from lira_schema_migrations where filename=$1", [filename]);
      if (existing.rowCount) {
        if (existing.rows[0].checksum !== checksum) throw new Error(`Applied migration was modified: ${filename}`);
        console.log(`[migrate] already applied ${filename}`);
        continue;
      }
      console.log(`[migrate] applying ${filename}`);
      await client.query("begin");
      try {
        await client.query(sql);
        await client.query("insert into lira_schema_migrations(filename, checksum) values ($1,$2)", [filename, checksum]);
        await client.query("commit");
      } catch (error) {
        await client.query("rollback");
        throw error;
      }
    }
    await client.query("select pg_advisory_unlock($1)", [lockId]);
  } finally {
    client.release();
  }
} finally {
  await pool.end();
}
