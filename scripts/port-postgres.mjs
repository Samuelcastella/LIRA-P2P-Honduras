import { readFile, writeFile } from "node:fs/promises";

async function text(path) { return readFile(path, "utf8"); }
async function save(path, value) { await writeFile(path, value); }
function mustReplace(source, search, replacement, label) {
  if (!source.includes(search)) throw new Error(`Missing expected source for ${label}`);
  return source.replace(search, replacement);
}

// Drizzle configuration.
let config = await text("drizzle.config.ts");
config = mustReplace(config, 'dialect: "mysql"', 'dialect: "postgresql"', "drizzle dialect");
await save("drizzle.config.ts", config);

// Package metadata. pnpm will regenerate the lockfile in the workflow.
const pkg = JSON.parse(await text("package.json"));
pkg.scripts["db:push"] = "drizzle-kit push";
pkg.scripts["db:generate"] = "drizzle-kit generate";
pkg.scripts["db:migrate"] = "drizzle-kit migrate";
pkg.scripts.migrate = "node scripts/migrate.mjs";
delete pkg.dependencies.mysql2;
pkg.dependencies.pg = "^8.13.1";
pkg.devDependencies["@types/pg"] = "^8.11.10";
await save("package.json", JSON.stringify(pkg, null, 2) + "\n");

let db = await text("server/db.ts");
db = mustReplace(db,
  'import { drizzle } from "drizzle-orm/mysql2";',
  'import { Pool } from "pg";\nimport { drizzle } from "drizzle-orm/node-postgres";',
  "postgres driver import",
);

db = mustReplace(db,
`let _db: ReturnType<typeof drizzle> | null = null;

export async function getDb() {
  if (!_db && process.env.DATABASE_URL) {
    try {
      _db = drizzle(process.env.DATABASE_URL);
    } catch (error) {
      console.warn("[Database] Failed to connect:", error);
      _db = null;
    }
  }
  return _db;
}`,
`let _pool: Pool | null = null;
let _db: ReturnType<typeof drizzle> | null = null;

export async function getDb() {
  if (!_db && ENV.databaseUrl) {
    try {
      _pool = new Pool({
        connectionString: ENV.databaseUrl,
        max: Number(process.env.PG_POOL_MAX ?? 10),
        idleTimeoutMillis: 30_000,
        connectionTimeoutMillis: 5_000,
        application_name: "lira-financial-core",
      });
      _pool.on("error", (error) => console.error("[Database] PostgreSQL pool error", error));
      _db = drizzle(_pool);
    } catch (error) {
      console.warn("[Database] Failed to connect:", error);
      _pool = null;
      _db = null;
    }
  }
  return _db;
}

export async function closeDb() {
  const pool = _pool;
  _pool = null;
  _db = null;
  if (pool) await pool.end();
}`,
  "postgres pool",
);

db = mustReplace(db,
  'await db.insert(users).values(values).onDuplicateKeyUpdate({ set: updateSet });',
  'await db.insert(users).values(values).onConflictDoUpdate({ target: users.openId, set: updateSet as any });',
  "user upsert",
);
db = mustReplace(db,
  '}).onDuplicateKeyUpdate({ set: { name: "LIRA Sandbox Ledger", lastSignedIn: new Date() } });',
  '}).onConflictDoUpdate({ target: users.openId, set: { name: "LIRA Sandbox Ledger", lastSignedIn: new Date(), updatedAt: new Date() } });',
  "system user upsert",
);
db = mustReplace(db,
`  }).onDuplicateKeyUpdate({
    set: {
      provider: SANDBOX_PROVIDER,`,
`  }).onConflictDoUpdate({
    target: reconciliationItems.transferId,
    set: {
      provider: SANDBOX_PROVIDER,`,
  "reconciliation upsert",
);

// MySQL affectedRows -> PostgreSQL RETURNING.
db = mustReplace(db,
`      ? await tx.update(securitySessions).set({ revokedAt: new Date() }).where(and(eq(securitySessions.userId, userId), ne(securitySessions.id, current.sessionId), sql\`${'${securitySessions.revokedAt}'} is null\`))
      : null;`,
`      ? await tx.update(securitySessions).set({ revokedAt: new Date(), updatedAt: new Date() }).where(and(eq(securitySessions.userId, userId), ne(securitySessions.id, current.sessionId), sql\`${'${securitySessions.revokedAt}'} is null\`)).returning({ id: securitySessions.id })
      : null;`,
  "pin rotation session revocation",
);
db = mustReplace(db,
  'revokedOtherSessions: Number(revoked?.[0].affectedRows ?? 0)',
  'revokedOtherSessions: revoked?.length ?? 0',
  "pin rotation count",
);
db = mustReplace(db,
`  const result = await tx.update(otpChallenges).set({ status: "consumed", consumedAt: now }).where(and(
    eq(otpChallenges.id, challengeId),
    eq(otpChallenges.userId, userId),
    eq(otpChallenges.sessionId, session.id),
    eq(otpChallenges.purpose, "transfer"),
    eq(otpChallenges.status, "verified"),
    sql\`${'${otpChallenges.expiresAt}'} > ${'${now}'}\`,
  ));
  if (Number(result[0].affectedRows ?? 0) !== 1)`,
`  const result = await tx.update(otpChallenges).set({ status: "consumed", consumedAt: now }).where(and(
    eq(otpChallenges.id, challengeId),
    eq(otpChallenges.userId, userId),
    eq(otpChallenges.sessionId, session.id),
    eq(otpChallenges.purpose, "transfer"),
    eq(otpChallenges.status, "verified"),
    sql\`${'${otpChallenges.expiresAt}'} > ${'${now}'}\`,
  )).returning({ id: otpChallenges.id });
  if (result.length !== 1)`,
  "challenge consume",
);
db = mustReplace(db,
`    const result = await tx.update(dailyTransferControls).set({
      attemptedMinor: sql\`${'${dailyTransferControls.attemptedMinor}'} + ${'${amountMinor}'}\`,
      attemptCount: sql\`${'${dailyTransferControls.attemptCount}'} + 1\`,
      updatedAt: new Date(),
    }).where(and(
      eq(dailyTransferControls.id, current.id),
      sql\`${'${dailyTransferControls.attemptedMinor}'} + ${'${amountMinor}'} <= ${'${SANDBOX_SECURITY_POLICY.maxDailyOutgoingMinor}'}\`,
    ));
    if (Number(result[0].affectedRows ?? 0) !== 1)`,
`    const result = await tx.update(dailyTransferControls).set({
      attemptedMinor: sql\`${'${dailyTransferControls.attemptedMinor}'} + ${'${amountMinor}'}\`,
      attemptCount: sql\`${'${dailyTransferControls.attemptCount}'} + 1\`,
      updatedAt: new Date(),
    }).where(and(
      eq(dailyTransferControls.id, current.id),
      sql\`${'${dailyTransferControls.attemptedMinor}'} + ${'${amountMinor}'} <= ${'${SANDBOX_SECURITY_POLICY.maxDailyOutgoingMinor}'}\`,
    )).returning({ id: dailyTransferControls.id });
    if (result.length !== 1)`,
  "daily limit update",
);
db = mustReplace(db,
  'const result = await db.update(securitySessions).set({ revokedAt: new Date() }).where(and(eq(securitySessions.id, sessionId), eq(securitySessions.userId, userId), sql`${securitySessions.revokedAt} is null`));\n  if (Number(result[0].affectedRows ?? 0) !== 1)',
  'const result = await db.update(securitySessions).set({ revokedAt: new Date(), updatedAt: new Date() }).where(and(eq(securitySessions.id, sessionId), eq(securitySessions.userId, userId), sql`${securitySessions.revokedAt} is null`)).returning({ id: securitySessions.id });\n  if (result.length !== 1)',
  "single session revoke",
);
db = mustReplace(db,
`    const result = await tx.update(securitySessions).set({ revokedAt: new Date() }).where(and(
      eq(securitySessions.userId, userId),
      ne(securitySessions.id, current.sessionId),
      sql\`${'${securitySessions.revokedAt}'} is null\`,
    ));
    const revoked = Number(result[0].affectedRows ?? 0);`,
`    const result = await tx.update(securitySessions).set({ revokedAt: new Date(), updatedAt: new Date() }).where(and(
      eq(securitySessions.userId, userId),
      ne(securitySessions.id, current.sessionId),
      sql\`${'${securitySessions.revokedAt}'} is null\`,
    )).returning({ id: securitySessions.id });
    const revoked = result.length;`,
  "other sessions revoke",
);
db = mustReplace(db,
  'const result = await tx.update(trustedDevices).set({ status: "revoked", revokedAt: new Date(), updatedAt: new Date() }).where(and(eq(trustedDevices.id, deviceId), eq(trustedDevices.userId, userId), sql`${trustedDevices.revokedAt} is null`));\n    if (Number(result[0].affectedRows ?? 0) !== 1)',
  'const result = await tx.update(trustedDevices).set({ status: "revoked", revokedAt: new Date(), updatedAt: new Date() }).where(and(eq(trustedDevices.id, deviceId), eq(trustedDevices.userId, userId), sql`${trustedDevices.revokedAt} is null`)).returning({ id: trustedDevices.id });\n    if (result.length !== 1)',
  "device revoke",
);

// PostgreSQL upserts for stable sandbox resources.
db = mustReplace(db,
  '}).onDuplicateKeyUpdate({ set: { status: "active", updatedAt: new Date() } });',
  '}).onConflictDoUpdate({ target: financialAccounts.id, set: { status: "active", updatedAt: new Date() } });',
  "clearing account upsert",
);
db = mustReplace(db,
  '}).onDuplicateKeyUpdate({ set: { status: "linked", displayName: "Banco Uno Sandbox" } });',
  '}).onConflictDoUpdate({ target: bankAccounts.id, set: { status: "linked", displayName: "Banco Uno Sandbox", updatedAt: new Date() } });',
  "bank account upsert",
);
db = mustReplace(db,
  '}).onDuplicateKeyUpdate({ set: { status: "active", bankAccountId, updatedAt: new Date() } });',
  '}).onConflictDoUpdate({ target: financialAccounts.id, set: { status: "active", bankAccountId, updatedAt: new Date() } });',
  "wallet upsert",
);
// Counterparty account is the remaining one-line financialAccounts upsert.
db = db.replace(
  '}).onDuplicateKeyUpdate({ set: { status: "active", updatedAt: new Date() } });',
  '}).onConflictDoUpdate({ target: financialAccounts.id, set: { status: "active", updatedAt: new Date() } });',
);

// Worker claim must be atomic and observable through RETURNING.
db = mustReplace(db,
`      }).where(and(eq(outboxEvents.id, event.id), eq(outboxEvents.status, "pending")));
      if (Number(claim[0].affectedRows ?? 0) !== 1) return null;`,
`      }).where(and(eq(outboxEvents.id, event.id), eq(outboxEvents.status, "pending"))).returning({ id: outboxEvents.id });
      if (claim.length !== 1) return null;`,
  "outbox claim",
);

// PostgreSQL returns changed rows directly.
db = mustReplace(db,
`  const result = await db.update(paymentRequests).set({ status: "expired" })
    .where(and(eq(paymentRequests.status, "open"), lt(paymentRequests.expiresAt, new Date())));
  return { affected: Number(result[0].affectedRows ?? 0) };`,
`  const result = await db.update(paymentRequests).set({ status: "expired", updatedAt: new Date() })
    .where(and(eq(paymentRequests.status, "open"), lt(paymentRequests.expiresAt, new Date())))
    .returning({ id: paymentRequests.id });
  return { affected: result.length };`,
  "payment request expiry",
);
db = mustReplace(db,
`    await tx.insert(operationalControls).values({ control: "transfers_enabled", enabled: enabled ? 1 : 0, reason, changedByUserId: adminUserId })
      .onDuplicateKeyUpdate({ set: { enabled: enabled ? 1 : 0, reason, changedByUserId: adminUserId, updatedAt: new Date() } });`,
`    await tx.insert(operationalControls).values({ control: "transfers_enabled", enabled, reason, changedByUserId: adminUserId, updatedAt: new Date() })
      .onConflictDoUpdate({ target: operationalControls.control, set: { enabled, reason, changedByUserId: adminUserId, updatedAt: new Date() } });`,
  "operational control upsert",
);

// Preserve the reconciled response contract.
db = db.replaceAll('return { paymentRequest: prior[0], replayed: true };', 'return { request: prior[0], replayed: true };');
db = db.replaceAll('return { paymentRequest, replayed: false };', 'return { request: paymentRequest, replayed: false };');

if (/mysql2|onDuplicateKeyUpdate|affectedRows/.test(db)) {
  const remaining = db.split("\n").map((line, i) => ({ line, n: i + 1 })).filter(({ line }) => /mysql2|onDuplicateKeyUpdate|affectedRows/.test(line));
  throw new Error(`MySQL-specific constructs remain: ${JSON.stringify(remaining)}`);
}
await save("server/db.ts", db);
