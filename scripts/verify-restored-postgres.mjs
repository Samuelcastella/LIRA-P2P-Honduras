import "dotenv/config";
import crypto from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import pg from "pg";

const { Pool } = pg;
const databaseUrl = process.env.RESTORE_VALIDATION_DATABASE_URL ?? process.env.DATABASE_URL;

if (!databaseUrl) {
  console.error(JSON.stringify({ event: "restore_validator_error", errorClass: "MissingDatabaseUrl" }));
  process.exit(2);
}

const requiredTables = [
  "users",
  "transfers",
  "journal_transactions",
  "ledger_entries",
  "outbox_events",
  "reconciliation_items",
  "audit_events",
  "operational_controls",
];

const requiredMigrations = [
  "001_initial_postgres.sql",
  "002_audit_events_immutability.sql",
  "003_outbox_dead_letter.sql",
];

const requiredTriggers = {
  audit_events: ["audit_events_no_update", "audit_events_no_delete"],
  ledger_entries: ["ledger_entries_immutable", "ledger_journal_balance_check"],
  journal_transactions: ["posted_journals_immutable"],
};

const pool = new Pool({
  connectionString: databaseUrl,
  max: 1,
  application_name: "lira-restore-validator",
});

function asNumber(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error("InvalidNumericResult");
  return parsed;
}

async function repositoryMigrationChecksums() {
  const dir = path.resolve("db/migrations");
  const files = (await readdir(dir)).filter((name) => /^\d+.*\.sql$/.test(name)).sort();
  const result = new Map();

  for (const filename of files) {
    const bytes = await readFile(path.join(dir, filename));
    result.set(filename, crypto.createHash("sha256").update(bytes).digest("hex"));
  }

  return result;
}

function missingFrom(actual, required) {
  const actualSet = new Set(actual);
  return required.filter((value) => !actualSet.has(value));
}

async function validate() {
  const repoChecksums = await repositoryMigrationChecksums();
  const client = await pool.connect();

  try {
    await client.query("begin read only");

    const versionResult = await client.query(
      "select current_setting('server_version') as server_version, pg_is_in_recovery() as in_recovery",
    );

    const migrationsResult = await client.query(
      "select filename, checksum from lira_schema_migrations order by filename",
    );
    const migrations = migrationsResult.rows.map((row) => ({
      filename: String(row.filename),
      checksum: String(row.checksum),
    }));

    const migrationChecksumMismatches = migrations
      .filter(({ filename, checksum }) => repoChecksums.has(filename) && repoChecksums.get(filename) !== checksum)
      .map(({ filename }) => filename);

    const tables = {};
    for (const tableName of requiredTables) {
      const existsResult = await client.query(
        "select to_regclass($1) is not null as exists",
        [`public.${tableName}`],
      );
      const exists = Boolean(existsResult.rows[0]?.exists);
      let rowCount = 0;
      if (exists) {
        const countResult = await client.query(`select count(*)::bigint as count from "${tableName}"`);
        rowCount = asNumber(countResult.rows[0]?.count ?? 0);
      }
      tables[tableName] = { exists, rowCount };
    }

    const triggerResult = await client.query(
      `select c.relname as table_name, t.tgname as trigger_name
         from pg_trigger t
         join pg_class c on c.oid = t.tgrelid
         join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public'
          and c.relname = any($1::text[])
          and not t.tgisinternal
        order by c.relname, t.tgname`,
      [Object.keys(requiredTriggers)],
    );

    const triggers = Object.fromEntries(Object.keys(requiredTriggers).map((table) => [table, []]));
    for (const row of triggerResult.rows) {
      if (triggers[row.table_name]) triggers[row.table_name].push(String(row.trigger_name));
    }

    const controlResult = await client.query(
      "select control, enabled, reason from operational_controls where control = 'transfers_enabled' limit 1",
    );
    const transfersControl = controlResult.rowCount
      ? {
          exists: true,
          control: String(controlResult.rows[0].control),
          enabled: Boolean(controlResult.rows[0].enabled),
          reason: String(controlResult.rows[0].reason),
        }
      : { exists: false, control: "transfers_enabled", enabled: null, reason: null };

    const unbalancedResult = await client.query(
      `select count(*)::bigint as count
         from (
           select jt.id
             from journal_transactions jt
             left join ledger_entries le on le."journalId" = jt.id
            group by jt.id
           having count(le.id) < 2
               or coalesce(sum(case when le.direction = 'debit' then le."amountMinor" else 0 end), 0)
                  <> coalesce(sum(case when le.direction = 'credit' then le."amountMinor" else 0 end), 0)
               or count(distinct le.currency) <> 1
         ) violations`,
    );

    const nonHnlTransfersResult = await client.query(
      "select count(*)::bigint as count from transfers where currency <> 'HNL'",
    );
    const nonHnlLedgerResult = await client.query(
      "select count(*)::bigint as count from ledger_entries where currency <> 'HNL'",
    );

    const migrationNames = migrations.map(({ filename }) => filename);
    const missingMigrations = missingFrom(migrationNames, requiredMigrations);
    const missingTables = requiredTables.filter((table) => !tables[table]?.exists);
    const missingTriggers = Object.entries(requiredTriggers).flatMap(([table, required]) =>
      missingFrom(triggers[table] ?? [], required).map((trigger) => `${table}.${trigger}`),
    );

    const integrity = {
      unbalancedJournalCount: asNumber(unbalancedResult.rows[0]?.count ?? 0),
      nonHnlTransferCount: asNumber(nonHnlTransfersResult.rows[0]?.count ?? 0),
      nonHnlLedgerCount: asNumber(nonHnlLedgerResult.rows[0]?.count ?? 0),
    };

    const inRecovery = Boolean(versionResult.rows[0]?.in_recovery);
    const passed =
      !inRecovery &&
      missingMigrations.length === 0 &&
      migrationChecksumMismatches.length === 0 &&
      missingTables.length === 0 &&
      missingTriggers.length === 0 &&
      transfersControl.exists &&
      integrity.unbalancedJournalCount === 0 &&
      integrity.nonHnlTransferCount === 0 &&
      integrity.nonHnlLedgerCount === 0;

    const summary = {
      timestamp: new Date().toISOString(),
      serverVersion: String(versionResult.rows[0]?.server_version ?? "unknown"),
      pgIsInRecovery: inRecovery,
      migrations: {
        count: migrations.length,
        files: migrations,
        missingRequired: missingMigrations,
        checksumMismatches: migrationChecksumMismatches,
      },
      tables,
      triggers,
      operationalControls: {
        transfersEnabled: transfersControl,
      },
      integrity,
      result: passed ? "VALIDATION_SUCCESS" : "VALIDATION_FAILED",
    };

    await client.query("rollback");
    console.log(JSON.stringify(summary));
    return passed ? 0 : 1;
  } catch (error) {
    try {
      await client.query("rollback");
    } catch {}
    console.error(JSON.stringify({
      event: "restore_validator_error",
      errorClass: error instanceof Error ? error.name : "UnknownError",
    }));
    return 2;
  } finally {
    client.release();
  }
}

try {
  process.exitCode = await validate();
} finally {
  await pool.end();
}
