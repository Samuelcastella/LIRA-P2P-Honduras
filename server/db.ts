import { and, desc, eq, inArray, lt, ne, or, sql } from "drizzle-orm";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import {
  auditEvents,
  bankAccounts,
  dailyTransferControls,
  financialAccounts,
  fundReservations,
  journalTransactions,
  ledgerEntries,
  operationalControls,
  outboxEvents,
  otpChallenges,
  paymentRequests,
  providerWebhookEvents,
  reconciliationItems,
  riskEvents,
  securitySessions,
  transfers,
  trustedDevices,
  type InsertUser,
  userSecurityProfiles,
  users,
} from "../drizzle/schema";
import {
  assertAllowedTransition,
  assertBalancedJournal,
  assertIdempotency,
  assertPositiveMinorAmount,
  createBalancedJournal,
  createCompensatingJournal,
  createJournalReference,
  createTransferReference,
  evaluateRisk,
  fingerprintIntent,
  hashAuditMetadata,
  type TransferIntent,
} from "./financial/domain";
import { SANDBOX_PROVIDER, SandboxBankAdapter, type ProviderWebhook } from "./financial/provider";
import {
  assertDistinctPin,
  assertOtp,
  assertPin,
  assertSandboxDailyLimit,
  assertSandboxTransferWithinSingleLimit,
  assertTrustedDeviceState,
  createOtpCode,
  deviceTrustEligibleAt,
  hashSecret,
  isExpired,
  nextPinFailureState,
  SANDBOX_SECURITY_POLICY,
  verifySecret,
} from "./security/domain";
import { ENV } from "./_core/env";

const SANDBOX_CLEARING_ACCOUNT_ID = "sandbox-clearing-hnl";
const SANDBOX_SYSTEM_OPEN_ID = "system-sandbox-ledger";
const SANDBOX_SEED_AMOUNT_MINOR = 325_000;

let _pool: Pool | null = null;
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
}

function requiredDb(db: ReturnType<typeof drizzle> | null) {
  if (!db) throw new Error("Database is unavailable; sandbox financial operations cannot proceed");
  return db;
}

export async function upsertUser(user: InsertUser): Promise<void> {
  if (!user.openId) throw new Error("User openId is required for upsert");
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot upsert user: database not available");
    return;
  }

  const values: InsertUser = { openId: user.openId };
  const updateSet: Record<string, unknown> = {};
  const textFields = ["name", "email", "loginMethod"] as const;
  textFields.forEach((field) => {
    if (user[field] !== undefined) {
      const value = user[field] ?? null;
      values[field] = value;
      updateSet[field] = value;
    }
  });
  values.lastSignedIn = user.lastSignedIn ?? new Date();
  updateSet.lastSignedIn = values.lastSignedIn;
  values.role = user.role ?? (user.openId === ENV.ownerOpenId ? "admin" : "user");
  updateSet.role = values.role;

  await db.insert(users).values(values).onConflictDoUpdate({ target: users.openId, set: updateSet as any });
}

export async function getUserByOpenId(openId: string) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(users).where(eq(users.openId, openId)).limit(1);
  return result[0];
}

async function ensureSandboxSystemUser(db: ReturnType<typeof drizzle>) {
  await db.insert(users).values({
    openId: SANDBOX_SYSTEM_OPEN_ID,
    name: "LIRA Sandbox Ledger",
    email: null,
    loginMethod: "system",
    role: "admin",
    lastSignedIn: new Date(),
  }).onConflictDoUpdate({ target: users.openId, set: { name: "LIRA Sandbox Ledger", lastSignedIn: new Date(), updatedAt: new Date() } });

  const [systemUser] = await db.select().from(users).where(eq(users.openId, SANDBOX_SYSTEM_OPEN_ID)).limit(1);
  if (!systemUser) throw new Error("Unable to initialize sandbox system user");
  return systemUser;
}

async function walletBalanceMinor(db: any, accountId: string) {
  const rows = await db.select({
    balance: sql<number>`coalesce(sum(case when ${ledgerEntries.direction} = 'credit' then ${ledgerEntries.amountMinor} else -${ledgerEntries.amountMinor} end), 0)`,
  }).from(ledgerEntries).where(eq(ledgerEntries.accountId, accountId));
  return Number(rows[0]?.balance ?? 0);
}

async function activeReservedMinor(db: any, accountId: string) {
  const rows = await db.select({
    reserved: sql<number>`coalesce(sum(${fundReservations.amountMinor}), 0)`,
  }).from(fundReservations).where(and(
    eq(fundReservations.accountId, accountId),
    eq(fundReservations.status, "active"),
  ));
  return Number(rows[0]?.reserved ?? 0);
}

async function availableBalanceMinor(db: any, accountId: string) {
  return Math.max(0, (await walletBalanceMinor(db, accountId)) - (await activeReservedMinor(db, accountId)));
}

async function lockFinancialAccount(tx: any, accountId: string) {
  await tx.execute(sql`select id from financial_accounts where id = ${accountId} for update`);
  const [account] = await tx.select().from(financialAccounts).where(eq(financialAccounts.id, accountId)).limit(1);
  if (!account) throw new Error("Financial account was not found");
  return account;
}

async function lockTransfer(tx: any, transferId: string) {
  await tx.execute(sql`select id from transfers where id = ${transferId} for update`);
  const [transfer] = await tx.select().from(transfers).where(eq(transfers.id, transferId)).limit(1);
  if (!transfer) throw new Error("Transfer was not found");
  return transfer;
}

async function upsertReconciliation(tx: any, params: {
  transferId: string;
  providerReference: string;
  expectedAmountMinor: number;
  reportedAmountMinor?: number | null;
  status: "match" | "status_mismatch" | "amount_mismatch" | "missing_internal" | "missing_external" | "duplicate_external" | "unknown";
}) {
  const now = new Date();
  await tx.insert(reconciliationItems).values({
    id: crypto.randomUUID(),
    transferId: params.transferId,
    provider: SANDBOX_PROVIDER,
    providerReference: params.providerReference,
    expectedAmountMinor: params.expectedAmountMinor,
    reportedAmountMinor: params.reportedAmountMinor ?? null,
    status: params.status,
    updatedAt: now,
  }).onConflictDoUpdate({
    target: reconciliationItems.transferId,
    set: {
      provider: SANDBOX_PROVIDER,
      providerReference: params.providerReference,
      expectedAmountMinor: params.expectedAmountMinor,
      reportedAmountMinor: params.reportedAmountMinor ?? null,
      status: params.status,
      updatedAt: now,
    },
  });
}

async function reserveFunds(tx: any, params: {
  transferId: string;
  accountId: string;
  amountMinor: number;
}) {
  await lockFinancialAccount(tx, params.accountId);
  const available = await availableBalanceMinor(tx, params.accountId);
  if (available < params.amountMinor) throw new Error("Insufficient sandbox balance after active reservations");

  await tx.insert(fundReservations).values({
    id: crypto.randomUUID(),
    transferId: params.transferId,
    accountId: params.accountId,
    amountMinor: params.amountMinor,
    currency: "HNL",
    status: "active",
  });
}

async function releaseReservation(tx: any, transferId: string, reason: string) {
  await tx.update(fundReservations).set({
    status: "released",
    releasedAt: new Date(),
    releaseReason: reason.slice(0, 120),
    updatedAt: new Date(),
  }).where(and(eq(fundReservations.transferId, transferId), eq(fundReservations.status, "active")));
}

async function captureReservation(tx: any, transferId: string) {
  await tx.update(fundReservations).set({
    status: "captured",
    capturedAt: new Date(),
    updatedAt: new Date(),
  }).where(and(eq(fundReservations.transferId, transferId), eq(fundReservations.status, "active")));
}

async function settleTransfer(tx: any, transferInput: any, providerReference: string, reportedAmountMinor: number) {
  const transfer = await lockTransfer(tx, transferInput.id);
  if (transfer.status === "settled" || transfer.status === "reversed") return transfer;
  if (transfer.status !== "processing" && transfer.status !== "unknown") {
    throw new Error(`Transfer state ${transfer.status} cannot settle`);
  }
  if (reportedAmountMinor !== transfer.amountMinor) {
    await upsertReconciliation(tx, {
      transferId: transfer.id,
      providerReference,
      expectedAmountMinor: transfer.amountMinor,
      reportedAmountMinor,
      status: "amount_mismatch",
    });
    throw new Error("Provider settlement amount does not match the transfer");
  }

  assertAllowedTransition(transfer.status, "settled");
  const journalId = crypto.randomUUID();
  const intent: TransferIntent = {
    senderUserId: transfer.senderUserId,
    recipientHandle: transfer.recipientHandle,
    sourceAccountId: transfer.sourceAccountId,
    destinationAccountId: transfer.destinationAccountId,
    amountMinor: transfer.amountMinor,
    currency: "HNL",
    idempotencyKey: transfer.idempotencyKey,
  };
  const entries = createBalancedJournal(journalId, transfer.id, intent);
  assertBalancedJournal(entries);

  await tx.insert(journalTransactions).values({
    id: journalId,
    reference: createJournalReference("SET"),
    transferId: transfer.id,
    type: "transfer_settlement",
    status: "posted",
    currency: "HNL",
  });
  await tx.insert(ledgerEntries).values(entries);
  await captureReservation(tx, transfer.id);
  await tx.update(transfers).set({
    status: "settled",
    providerReference,
    settlementJournalId: journalId,
    settledAt: new Date(),
    unknownAt: null,
    unknownReason: null,
    updatedAt: new Date(),
  }).where(eq(transfers.id, transfer.id));
  await upsertReconciliation(tx, {
    transferId: transfer.id,
    providerReference,
    expectedAmountMinor: transfer.amountMinor,
    reportedAmountMinor,
    status: "match",
  });

  const [settled] = await tx.select().from(transfers).where(eq(transfers.id, transfer.id)).limit(1);
  return settled ?? transfer;
}

async function failTransfer(tx: any, transferInput: any, providerReference: string, failureCode: string) {
  const transfer = await lockTransfer(tx, transferInput.id);
  if (transfer.status === "failed") return transfer;
  if (transfer.status !== "processing" && transfer.status !== "unknown") {
    throw new Error(`Transfer state ${transfer.status} cannot fail from provider outcome`);
  }
  assertAllowedTransition(transfer.status, "failed");
  await releaseReservation(tx, transfer.id, failureCode);
  await tx.update(transfers).set({
    status: "failed",
    providerReference,
    failureCode: failureCode.slice(0, 80),
    unknownAt: null,
    unknownReason: null,
    updatedAt: new Date(),
  }).where(eq(transfers.id, transfer.id));
  await upsertReconciliation(tx, {
    transferId: transfer.id,
    providerReference,
    expectedAmountMinor: transfer.amountMinor,
    reportedAmountMinor: null,
    status: "match",
  });
  const [failed] = await tx.select().from(transfers).where(eq(transfers.id, transfer.id)).limit(1);
  return failed ?? transfer;
}

async function reverseTransfer(tx: any, transferInput: any, providerReference: string) {
  const transfer = await lockTransfer(tx, transferInput.id);
  if (transfer.status === "reversed") return transfer;
  if (transfer.status !== "settled" || !transfer.settlementJournalId) {
    throw new Error("Only a settled transfer with a settlement journal can be reversed");
  }

  const originalEntries = await tx.select().from(ledgerEntries).where(eq(ledgerEntries.journalId, transfer.settlementJournalId));
  if (originalEntries.length < 2) throw new Error("Settlement journal entries are missing for reversal");

  assertAllowedTransition("settled", "reversed");
  const reversalJournalId = crypto.randomUUID();
  const entries = createCompensatingJournal(reversalJournalId, transfer.id, originalEntries);
  await tx.insert(journalTransactions).values({
    id: reversalJournalId,
    reference: createJournalReference("REV"),
    transferId: transfer.id,
    type: "reversal",
    status: "posted",
    currency: "HNL",
    reversesJournalId: transfer.settlementJournalId,
  });
  await tx.insert(ledgerEntries).values(entries);
  await tx.update(transfers).set({
    status: "reversed",
    providerReference,
    reversalJournalId,
    reversedAt: new Date(),
    updatedAt: new Date(),
  }).where(eq(transfers.id, transfer.id));
  await upsertReconciliation(tx, {
    transferId: transfer.id,
    providerReference,
    expectedAmountMinor: transfer.amountMinor,
    reportedAmountMinor: transfer.amountMinor,
    status: "match",
  });

  const [reversed] = await tx.select().from(transfers).where(eq(transfers.id, transfer.id)).limit(1);
  return reversed ?? transfer;
}

async function writeAudit(db: any, params: {
  actorUserId: number | null;
  actorType: "user" | "admin" | "system" | "provider";
  action: string;
  resource: string;
  resourceId: string;
  requestId: string;
  metadata: Record<string, unknown>;
}) {
  await db.insert(auditEvents).values({
    id: crypto.randomUUID(),
    actorUserId: params.actorUserId,
    actorType: params.actorType,
    action: params.action,
    resource: params.resource,
    resourceId: params.resourceId,
    requestId: params.requestId,
    metadataHash: hashAuditMetadata(params.metadata),
  });
}

export type SecurityClientContext = {
  deviceFingerprint: string;
  sessionFingerprint: string;
  deviceLabel: string;
  platform: string;
};

function securityFingerprint(value: string) {
  return hashAuditMetadata({ value });
}

function currentUtcDayStart(now = new Date()) {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

async function ensureSecurityContext(
  db: any,
  userId: number,
  context: SecurityClientContext,
  options: { allowRestricted?: boolean } = {},
) {
  const deviceFingerprintHash = securityFingerprint(context.deviceFingerprint);
  const sessionFingerprintHash = securityFingerprint(context.sessionFingerprint);
  let [device] = await db.select().from(trustedDevices).where(and(eq(trustedDevices.userId, userId), eq(trustedDevices.fingerprintHash, deviceFingerprintHash))).limit(1);
  if (!device) {
    const requestedAt = new Date();
    const deviceId = crypto.randomUUID();
    await db.insert(trustedDevices).values({
      id: deviceId,
      userId,
      fingerprintHash: deviceFingerprintHash,
      label: context.deviceLabel,
      platform: context.platform,
      status: "new",
      enrollmentRequestedAt: requestedAt,
      eligibleAt: deviceTrustEligibleAt(requestedAt),
    });
    [device] = await db.select().from(trustedDevices).where(eq(trustedDevices.id, deviceId)).limit(1);
    if (device) {
      await writeAudit(db, {
        actorUserId: userId,
        actorType: "system",
        action: "trusted_device_discovered",
        resource: "trusted_device",
        resourceId: device.id,
        requestId: device.id,
        metadata: { status: "new", sandbox: true },
      });
    }
  }
  if (!device || device.revokedAt || device.status === "revoked") throw new Error("Este dispositivo fue revocado; usa un dispositivo de confianza para continuar");
  if (device.status === "restricted" && !options.allowRestricted) {
    throw new Error("Este dispositivo está restringido y no puede realizar cambios de seguridad");
  }
  await db.update(trustedDevices).set({ label: context.deviceLabel, platform: context.platform, lastUsedAt: new Date(), updatedAt: new Date() }).where(eq(trustedDevices.id, device.id));

  let [session] = await db.select().from(securitySessions).where(and(eq(securitySessions.userId, userId), eq(securitySessions.sessionFingerprintHash, sessionFingerprintHash))).limit(1);
  if (!session) {
    const sessionId = crypto.randomUUID();
    await db.insert(securitySessions).values({ id: sessionId, userId, deviceId: device.id, sessionFingerprintHash, label: context.deviceLabel, authStrength: "basic" });
    [session] = await db.select().from(securitySessions).where(eq(securitySessions.id, sessionId)).limit(1);
  }
  if (!session || session.revokedAt) throw new Error("Esta sesión fue revocada; inicia una nueva sesión de seguridad");
  if (session.deviceId !== device.id) throw new Error("La sesión de seguridad no coincide con este dispositivo; inicia una nueva sesión");
  await db.update(securitySessions).set({ label: context.deviceLabel, lastSeenAt: new Date(), updatedAt: new Date() }).where(eq(securitySessions.id, session.id));
  return { deviceId: device.id, sessionId: session.id };
}

export async function getSecurityOverview(userId: number, context: SecurityClientContext) {
  const db = requiredDb(await getDb());
  return db.transaction(async (tx) => {
    const current = await ensureSecurityContext(tx, userId, context, { allowRestricted: true });
    const periodStart = currentUtcDayStart();
    const [profile, devices, sessions, dailyControls, recentSecurityEvents] = await Promise.all([
      tx.select().from(userSecurityProfiles).where(eq(userSecurityProfiles.userId, userId)).limit(1),
      tx.select().from(trustedDevices).where(eq(trustedDevices.userId, userId)).orderBy(desc(trustedDevices.lastUsedAt)),
      tx.select().from(securitySessions).where(eq(securitySessions.userId, userId)).orderBy(desc(securitySessions.lastSeenAt)),
      tx.select().from(dailyTransferControls).where(and(eq(dailyTransferControls.userId, userId), eq(dailyTransferControls.periodStart, periodStart))).limit(1),
      tx.select({ id: auditEvents.id, action: auditEvents.action, resource: auditEvents.resource, createdAt: auditEvents.createdAt }).from(auditEvents).where(eq(auditEvents.actorUserId, userId)).orderBy(desc(auditEvents.createdAt)).limit(8),
    ]);
    const daily = dailyControls[0];
    const attemptedMinor = Number(daily?.attemptedMinor ?? 0);
    return {
      hasPin: Boolean(profile[0]?.pinHash),
      pinLockedUntil: profile[0]?.lockedUntil ?? null,
      devices,
      sessions,
      recentSecurityEvents,
      currentDeviceId: current.deviceId,
      currentSessionId: current.sessionId,
      activeSessionCount: sessions.filter((session) => !session.revokedAt).length,
      transferLimits: {
        period: "utc_day" as const,
        attemptedMinor,
        remainingMinor: Math.max(0, SANDBOX_SECURITY_POLICY.maxDailyOutgoingMinor - attemptedMinor),
        maxDailyMinor: SANDBOX_SECURITY_POLICY.maxDailyOutgoingMinor,
        maxSingleMinor: SANDBOX_SECURITY_POLICY.maxSingleTransferMinor,
      },
      sandboxOnly: true as const,
    };
  });
}

export async function setUserPin(userId: number, context: SecurityClientContext, pin: string, currentPin?: string) {
  assertPin(pin);
  const db = requiredDb(await getDb());
  const outcome = await db.transaction(async (tx) => {
    const current = await ensureSecurityContext(tx, userId, context);
    const [profile] = await tx.select().from(userSecurityProfiles).where(eq(userSecurityProfiles.userId, userId)).limit(1);
    if (profile?.lockedUntil && !isExpired(profile.lockedUntil)) throw new Error("El PIN está bloqueado temporalmente por intentos fallidos");
    const isRotation = Boolean(profile?.pinHash);
    if (isRotation) {
      if (!currentPin) throw new Error("Ingresa tu PIN actual para actualizarlo");
      assertPin(currentPin);
      assertDistinctPin(currentPin, pin);
      if (!verifySecret(currentPin, profile?.pinHash)) {
        const next = nextPinFailureState(profile?.failedPinAttempts ?? 0);
        await tx.update(userSecurityProfiles).set(next).where(eq(userSecurityProfiles.userId, userId));
        await writeAudit(tx, { actorUserId: userId, actorType: "user", action: "security_pin_rotation_rejected", resource: "security_profile", resourceId: String(userId), requestId: crypto.randomUUID(), metadata: { reason: "current_pin_invalid" } });
        return { ok: false as const, message: next.lockedUntil ? "PIN bloqueado durante 15 minutos por intentos fallidos" : "PIN actual incorrecto" };
      }
    }
    const nextHash = hashSecret(pin);
    if (!isRotation) {
      await tx.insert(userSecurityProfiles).values({ userId, pinHash: nextHash, failedPinAttempts: 0, lockedUntil: null, pinUpdatedAt: new Date() });
    } else {
      await tx.update(userSecurityProfiles).set({ pinHash: nextHash, failedPinAttempts: 0, lockedUntil: null, pinUpdatedAt: new Date() }).where(eq(userSecurityProfiles.userId, userId));
    }
    const revoked = isRotation
      ? await tx.update(securitySessions).set({ revokedAt: new Date(), updatedAt: new Date() }).where(and(eq(securitySessions.userId, userId), ne(securitySessions.id, current.sessionId), sql`${securitySessions.revokedAt} is null`)).returning({ id: securitySessions.id })
      : null;
    await writeAudit(tx, { actorUserId: userId, actorType: "user", action: isRotation ? "security_pin_rotated" : "security_pin_set", resource: "security_profile", resourceId: String(userId), requestId: crypto.randomUUID(), metadata: { method: "scrypt", revokedOtherSessions: revoked?.length ?? 0, sandbox: true } });
    return { ok: true as const };
  });
  if (!outcome.ok) throw new Error(outcome.message);
  return { success: true } as const;
}

export async function startTransferVerification(userId: number, context: SecurityClientContext) {
  const db = requiredDb(await getDb());
  return db.transaction(async (tx) => {
    const current = await ensureSecurityContext(tx, userId, context);
    const [device] = await tx.select().from(trustedDevices).where(eq(trustedDevices.id, current.deviceId)).limit(1);
    if (!device || device.revokedAt) throw new Error("El dispositivo de esta sesión no está activo");
    assertTrustedDeviceState(device.status);
    const [profile] = await tx.select().from(userSecurityProfiles).where(eq(userSecurityProfiles.userId, userId)).limit(1);
    if (!profile?.pinHash) throw new Error("Configura tu PIN de seguridad antes de validar una transferencia");
    if (profile.lockedUntil && !isExpired(profile.lockedUntil)) throw new Error("El PIN está bloqueado temporalmente por intentos fallidos");
    const code = createOtpCode();
    const id = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + SANDBOX_SECURITY_POLICY.otpLifetimeMs);
    await tx.insert(otpChallenges).values({ id, userId, sessionId: current.sessionId, purpose: "transfer", codeHash: hashSecret(code), status: "issued", attempts: 0, expiresAt });
    await writeAudit(tx, { actorUserId: userId, actorType: "system", action: "transfer_otp_issued", resource: "otp_challenge", resourceId: id, requestId: id, metadata: { purpose: "transfer", expiresAt: expiresAt.toISOString(), sandbox: true } });
    // A real product sends this through a verified out-of-band channel. This explicit return exists only for the sandbox UI.
    return { challengeId: id, expiresAt, sandboxCode: code };
  });
}

export async function verifyTransferChallenge(userId: number, context: SecurityClientContext, challengeId: string, pin: string, code: string) {
  assertPin(pin);
  assertOtp(code);
  const db = requiredDb(await getDb());
  const outcome = await db.transaction(async (tx) => {
    const current = await ensureSecurityContext(tx, userId, context);
    const [device] = await tx.select().from(trustedDevices).where(eq(trustedDevices.id, current.deviceId)).limit(1);
    if (!device || device.revokedAt) throw new Error("El dispositivo de esta sesión no está activo");
    assertTrustedDeviceState(device.status);
    const [profile] = await tx.select().from(userSecurityProfiles).where(eq(userSecurityProfiles.userId, userId)).limit(1);
    if (!profile?.pinHash) throw new Error("Configura un PIN antes de validar transferencias");
    if (profile.lockedUntil && !isExpired(profile.lockedUntil)) throw new Error("El PIN está bloqueado temporalmente por intentos fallidos");
    if (!verifySecret(pin, profile.pinHash)) {
      const next = nextPinFailureState(profile.failedPinAttempts);
      await tx.update(userSecurityProfiles).set(next).where(eq(userSecurityProfiles.userId, userId));
      return { ok: false as const, message: next.lockedUntil ? "PIN bloqueado durante 15 minutos por intentos fallidos" : "PIN incorrecto" };
    }
    const [challenge] = await tx.select().from(otpChallenges).where(and(eq(otpChallenges.id, challengeId), eq(otpChallenges.userId, userId), eq(otpChallenges.sessionId, current.sessionId), eq(otpChallenges.purpose, "transfer"))).limit(1);
    if (!challenge) throw new Error("El desafío de seguridad no pertenece a esta sesión");
    if (challenge.status !== "issued" || isExpired(challenge.expiresAt)) {
      if (challenge.status === "issued") await tx.update(otpChallenges).set({ status: "expired" }).where(eq(otpChallenges.id, challenge.id));
      return { ok: false as const, message: "El código expiró o ya fue usado; solicita uno nuevo" };
    }
    if (!verifySecret(code, challenge.codeHash)) {
      const attempts = challenge.attempts + 1;
      await tx.update(otpChallenges).set({ attempts, status: attempts >= SANDBOX_SECURITY_POLICY.maxOtpAttempts ? "locked" : "issued" }).where(eq(otpChallenges.id, challenge.id));
      return { ok: false as const, message: attempts >= SANDBOX_SECURITY_POLICY.maxOtpAttempts ? "Código bloqueado por demasiados intentos" : "Código de verificación incorrecto" };
    }
    await tx.update(userSecurityProfiles).set({ failedPinAttempts: 0, lockedUntil: null }).where(eq(userSecurityProfiles.userId, userId));
    await tx.update(otpChallenges).set({ status: "verified", verifiedAt: new Date() }).where(eq(otpChallenges.id, challenge.id));
    await writeAudit(tx, { actorUserId: userId, actorType: "user", action: "transfer_otp_verified", resource: "otp_challenge", resourceId: challenge.id, requestId: challenge.id, metadata: { sessionId: current.sessionId } });
    return { ok: true as const };
  });
  if (!outcome.ok) throw new Error(outcome.message);
  return { success: true } as const;
}

async function consumeVerifiedTransferChallenge(tx: any, userId: number, sessionFingerprint: string, challengeId: string) {
  const sessionFingerprintHash = securityFingerprint(sessionFingerprint);
  const [session] = await tx.select().from(securitySessions).where(and(eq(securitySessions.userId, userId), eq(securitySessions.sessionFingerprintHash, sessionFingerprintHash))).limit(1);
  if (!session || session.revokedAt) throw new Error("La sesión de seguridad no está activa");
  const [device] = await tx.select().from(trustedDevices).where(eq(trustedDevices.id, session.deviceId)).limit(1);
  if (!device || device.revokedAt) throw new Error("El dispositivo de la sesión no está activo");
  assertTrustedDeviceState(device.status);
  const now = new Date();
  const result = await tx.update(otpChallenges).set({ status: "consumed", consumedAt: now }).where(and(
    eq(otpChallenges.id, challengeId),
    eq(otpChallenges.userId, userId),
    eq(otpChallenges.sessionId, session.id),
    eq(otpChallenges.purpose, "transfer"),
    eq(otpChallenges.status, "verified"),
    sql`${otpChallenges.expiresAt} > ${now}`,
  )).returning({ id: otpChallenges.id });
  if (result.length !== 1) throw new Error("La verificación de la transferencia no es válida");
  await writeAudit(tx, { actorUserId: userId, actorType: "system", action: "transfer_otp_consumed", resource: "otp_challenge", resourceId: challengeId, requestId: challengeId, metadata: { sessionId: session.id } });
}

async function reserveSandboxDailyTransferLimit(tx: any, userId: number, amountMinor: number, requestId: string) {
  assertSandboxTransferWithinSingleLimit(amountMinor);
  const periodStart = currentUtcDayStart();
  const [current] = await tx.select().from(dailyTransferControls).where(and(eq(dailyTransferControls.userId, userId), eq(dailyTransferControls.periodStart, periodStart))).limit(1);
  if (!current) {
    assertSandboxDailyLimit(0, amountMinor);
    await tx.insert(dailyTransferControls).values({ id: crypto.randomUUID(), userId, periodStart, attemptedMinor: amountMinor, attemptCount: 1 });
  } else {
    const result = await tx.update(dailyTransferControls).set({
      attemptedMinor: sql`${dailyTransferControls.attemptedMinor} + ${amountMinor}`,
      attemptCount: sql`${dailyTransferControls.attemptCount} + 1`,
      updatedAt: new Date(),
    }).where(and(
      eq(dailyTransferControls.id, current.id),
      sql`${dailyTransferControls.attemptedMinor} + ${amountMinor} <= ${SANDBOX_SECURITY_POLICY.maxDailyOutgoingMinor}`,
    )).returning({ id: dailyTransferControls.id });
    if (result.length !== 1) throw new Error("El monto supera el límite diario del sandbox");
  }
  await writeAudit(tx, { actorUserId: userId, actorType: "system", action: "sandbox_daily_limit_reserved", resource: "daily_transfer_control", resourceId: `${userId}:${periodStart.toISOString().slice(0, 10)}`, requestId, metadata: { amountMinor, period: "utc_day", sandbox: true } });
}

export async function revokeSecuritySession(userId: number, sessionId: string) {
  const db = requiredDb(await getDb());
  const result = await db.update(securitySessions).set({ revokedAt: new Date(), updatedAt: new Date() }).where(and(eq(securitySessions.id, sessionId), eq(securitySessions.userId, userId), sql`${securitySessions.revokedAt} is null`)).returning({ id: securitySessions.id });
  if (result.length !== 1) throw new Error("La sesión no está activa o no pertenece al usuario");
  await writeAudit(db, { actorUserId: userId, actorType: "user", action: "security_session_revoked", resource: "security_session", resourceId: sessionId, requestId: sessionId, metadata: {} });
  return { success: true } as const;
}

export async function revokeOtherSecuritySessions(userId: number, context: SecurityClientContext) {
  const db = requiredDb(await getDb());
  return db.transaction(async (tx) => {
    const current = await ensureSecurityContext(tx, userId, context);
    const result = await tx.update(securitySessions).set({ revokedAt: new Date(), updatedAt: new Date() }).where(and(
      eq(securitySessions.userId, userId),
      ne(securitySessions.id, current.sessionId),
      sql`${securitySessions.revokedAt} is null`,
    )).returning({ id: securitySessions.id });
    const revoked = result.length;
    await writeAudit(tx, { actorUserId: userId, actorType: "user", action: "security_other_sessions_revoked", resource: "security_session", resourceId: current.sessionId, requestId: crypto.randomUUID(), metadata: { revoked, sandbox: true } });
    return { success: true, revoked } as const;
  });
}

export async function revokeTrustedDevice(userId: number, deviceId: string) {
  const db = requiredDb(await getDb());
  await db.transaction(async (tx) => {
    const result = await tx.update(trustedDevices).set({ status: "revoked", revokedAt: new Date(), updatedAt: new Date() }).where(and(eq(trustedDevices.id, deviceId), eq(trustedDevices.userId, userId), sql`${trustedDevices.revokedAt} is null`)).returning({ id: trustedDevices.id });
    if (result.length !== 1) throw new Error("El dispositivo no está activo o no pertenece al usuario");
    await tx.update(securitySessions).set({ revokedAt: new Date() }).where(and(eq(securitySessions.deviceId, deviceId), eq(securitySessions.userId, userId), sql`${securitySessions.revokedAt} is null`));
    await writeAudit(tx, { actorUserId: userId, actorType: "user", action: "trusted_device_revoked", resource: "trusted_device", resourceId: deviceId, requestId: deviceId, metadata: {} });
  });
  return { success: true } as const;
}

export async function ensureSandboxWorkspace(userId: number) {
  const db = requiredDb(await getDb());
  const systemUser = await ensureSandboxSystemUser(db);
  const bankAccountId = `sandbox-bank-${userId}`;
  const walletId = `wallet-${userId}`;

  await db.transaction(async (tx) => {
    await tx.insert(financialAccounts).values({
      id: SANDBOX_CLEARING_ACCOUNT_ID,
      userId: null,
      bankAccountId: null,
      accountType: "sandbox_clearing",
      currency: "HNL",
      status: "active",
    }).onConflictDoUpdate({ target: financialAccounts.id, set: { status: "active", updatedAt: new Date() } });

    await tx.insert(bankAccounts).values({
      id: bankAccountId,
      userId,
      provider: SANDBOX_PROVIDER,
      externalAccountId: `SBX-${userId}`,
      displayName: "Banco Uno Sandbox",
      lastFour: "8421",
      status: "linked",
      tokenReference: `sandbox-reference-${userId}`,
    }).onConflictDoUpdate({ target: bankAccounts.id, set: { status: "linked", displayName: "Banco Uno Sandbox", updatedAt: new Date() } });

    await tx.insert(financialAccounts).values({
      id: walletId,
      userId,
      bankAccountId,
      accountType: "user_wallet",
      currency: "HNL",
      status: "active",
    }).onConflictDoUpdate({ target: financialAccounts.id, set: { status: "active", bankAccountId, updatedAt: new Date() } });

    const seedKey = `sandbox-seed-v1-${userId}`;
    const [existingSeed] = await tx.select().from(transfers).where(and(
      eq(transfers.senderUserId, systemUser.id),
      eq(transfers.idempotencyKey, seedKey),
    )).limit(1);
    if (existingSeed) return;

    const seedTransferId = crypto.randomUUID();
    const seedJournalId = crypto.randomUUID();
    const seedIntent: TransferIntent = {
      senderUserId: systemUser.id,
      recipientHandle: `@sandbox-user-${userId}`,
      sourceAccountId: SANDBOX_CLEARING_ACCOUNT_ID,
      destinationAccountId: walletId,
      amountMinor: SANDBOX_SEED_AMOUNT_MINOR,
      currency: "HNL",
      idempotencyKey: seedKey,
    };
    const entries = createBalancedJournal(seedJournalId, seedTransferId, seedIntent);
    assertBalancedJournal(entries);

    await tx.insert(transfers).values({
      id: seedTransferId,
      reference: createTransferReference(),
      senderUserId: systemUser.id,
      recipientUserId: userId,
      recipientHandle: seedIntent.recipientHandle,
      sourceAccountId: seedIntent.sourceAccountId,
      destinationAccountId: seedIntent.destinationAccountId,
      amountMinor: seedIntent.amountMinor,
      currency: "HNL",
      status: "settled",
      riskDecision: "allow",
      idempotencyKey: seedKey,
      requestFingerprint: fingerprintIntent(seedIntent),
      providerReference: `SBX-FUND-${userId}`,
      authorizedAt: new Date(),
      providerSubmittedAt: new Date(),
      providerAcceptedAt: new Date(),
      settledAt: new Date(),
    });
    await tx.insert(journalTransactions).values({
      id: seedJournalId,
      reference: createJournalReference("SEED"),
      transferId: seedTransferId,
      type: "sandbox_seed",
      status: "posted",
      currency: "HNL",
    });
    await tx.insert(ledgerEntries).values(entries);
    await tx.update(transfers).set({ settlementJournalId: seedJournalId, updatedAt: new Date() }).where(eq(transfers.id, seedTransferId));
    await upsertReconciliation(tx, {
      transferId: seedTransferId,
      providerReference: `SBX-FUND-${userId}`,
      expectedAmountMinor: seedIntent.amountMinor,
      reportedAmountMinor: seedIntent.amountMinor,
      status: "match",
    });
    await writeAudit(tx, {
      actorUserId: systemUser.id,
      actorType: "system",
      action: "sandbox_funding_posted",
      resource: "transfer",
      resourceId: seedTransferId,
      requestId: seedKey,
      metadata: { environment: "sandbox", amountMinor: seedIntent.amountMinor, currency: "HNL", journalId: seedJournalId },
    });
  });

  return { walletId, bankAccountId };
}

export async function getFinancialDashboard(userId: number) {
  const db = requiredDb(await getDb());
  const { walletId } = await ensureSandboxWorkspace(userId);
  const balanceMinor = await availableBalanceMinor(db, walletId);
  const ledgerBalanceMinor = await walletBalanceMinor(db, walletId);
  const [accounts, recentTransfers, recentRisk, controls] = await Promise.all([
    db.select().from(bankAccounts).where(and(eq(bankAccounts.userId, userId), eq(bankAccounts.status, "linked"))),
    db.select().from(transfers).where(or(eq(transfers.senderUserId, userId), eq(transfers.recipientUserId, userId))).orderBy(desc(transfers.createdAt)).limit(20),
    db.select().from(riskEvents).where(eq(riskEvents.userId, userId)).orderBy(desc(riskEvents.createdAt)).limit(8),
    db.select().from(operationalControls).where(eq(operationalControls.control, "transfers_enabled")).limit(1),
  ]);
  return {
    environment: "sandbox" as const,
    currency: "HNL" as const,
    balanceMinor,
    ledgerBalanceMinor,
    accounts,
    recentTransfers,
    recentRisk,
    transfersEnabled: controls[0]?.enabled !== 0,
  };
}

async function resolveCounterpartyAccount(db: ReturnType<typeof drizzle>, handle: string) {
  const normalized = handle.trim().toLowerCase().replace(/[^a-z0-9_@.-]/g, "");
  if (!normalized || normalized.length < 2) throw new Error("A valid recipient handle is required");
  const id = `sandbox-counterparty-${hashAuditMetadata({ normalized }).slice(0, 20)}`;
  await db.insert(financialAccounts).values({
    id,
    userId: null,
    bankAccountId: null,
    accountType: "user_wallet",
    currency: "HNL",
    status: "active",
  }).onConflictDoUpdate({ target: financialAccounts.id, set: { status: "active", updatedAt: new Date() } });
  return id;
}

export async function createSandboxTransfer(userId: number, input: Omit<TransferIntent, "senderUserId" | "sourceAccountId" | "destinationAccountId"> & { verificationChallengeId: string; sessionFingerprint: string }) {
  const db = requiredDb(await getDb());
  const { walletId } = await ensureSandboxWorkspace(userId);
  const { verificationChallengeId, sessionFingerprint, ...transferInput } = input;
  const destinationAccountId = await resolveCounterpartyAccount(db, transferInput.recipientHandle);
  const intent: TransferIntent = {
    ...transferInput,
    senderUserId: userId,
    sourceAccountId: walletId,
    destinationAccountId,
  };
  const fingerprint = fingerprintIntent(intent);

  return db.transaction(async (tx) => {
    const [control] = await tx.select().from(operationalControls).where(eq(operationalControls.control, "transfers_enabled")).limit(1);
    if (control?.enabled === 0) throw new Error("Transfers are temporarily paused by an operational control");

    const [prior] = await tx.select().from(transfers).where(and(
      eq(transfers.senderUserId, userId),
      eq(transfers.idempotencyKey, intent.idempotencyKey),
    )).limit(1);
    if (prior) {
      assertIdempotency(prior.requestFingerprint, fingerprint);
      return { transfer: prior, replayed: true };
    }

    assertSandboxTransferWithinSingleLimit(intent.amountMinor);
    await reserveSandboxDailyTransferLimit(tx, userId, intent.amountMinor, intent.idempotencyKey);
    await consumeVerifiedTransferChallenge(tx, userId, sessionFingerprint, verificationChallengeId);

    const recent = await tx.select({ count: sql<number>`count(*)` }).from(transfers)
      .where(and(eq(transfers.senderUserId, userId), sql`${transfers.createdAt} > date_sub(now(), interval 5 minute)`));
    const risk = evaluateRisk({ amountMinor: intent.amountMinor, attemptsInFiveMinutes: Number(recent[0]?.count ?? 0) });
    const transferId = crypto.randomUUID();
    const reference = createTransferReference();

    await tx.insert(transfers).values({
      id: transferId,
      reference,
      senderUserId: userId,
      recipientUserId: null,
      recipientHandle: intent.recipientHandle.trim().toLowerCase(),
      sourceAccountId: walletId,
      destinationAccountId,
      amountMinor: intent.amountMinor,
      currency: intent.currency,
      status: "created",
      riskDecision: risk.decision,
      idempotencyKey: intent.idempotencyKey,
      requestFingerprint: fingerprint,
    });
    await writeAudit(tx, {
      actorUserId: userId,
      actorType: "user",
      action: "transfer_created",
      resource: "transfer",
      resourceId: transferId,
      requestId: intent.idempotencyKey,
      metadata: { amountMinor: intent.amountMinor, currency: intent.currency },
    });

    assertAllowedTransition("created", "authenticating");
    await tx.update(transfers).set({ status: "authenticating", updatedAt: new Date() }).where(eq(transfers.id, transferId));
    assertAllowedTransition("authenticating", "risk_review");
    await tx.update(transfers).set({ status: "risk_review", updatedAt: new Date() }).where(eq(transfers.id, transferId));
    await tx.insert(riskEvents).values({
      id: crypto.randomUUID(),
      userId,
      transferId,
      rule: risk.rule,
      score: risk.score,
      severity: risk.severity,
      decision: risk.decision,
      policyVersion: risk.policyVersion,
    });
    await writeAudit(tx, {
      actorUserId: userId,
      actorType: "system",
      action: "risk_decision_recorded",
      resource: "transfer",
      resourceId: transferId,
      requestId: intent.idempotencyKey,
      metadata: { decision: risk.decision, rule: risk.rule, policyVersion: risk.policyVersion },
    });

    if (risk.decision === "block" || risk.decision === "review") {
      assertAllowedTransition("risk_review", "declined");
      await tx.update(transfers).set({ status: "declined", failureCode: `risk_${risk.decision}`, updatedAt: new Date() }).where(eq(transfers.id, transferId));
      await writeAudit(tx, {
        actorUserId: userId,
        actorType: "system",
        action: "transfer_declined",
        resource: "transfer",
        resourceId: transferId,
        requestId: intent.idempotencyKey,
        metadata: { reason: `risk_${risk.decision}` },
      });
      const [declined] = await tx.select().from(transfers).where(eq(transfers.id, transferId)).limit(1);
      if (!declined) throw new Error("Transfer was not persisted");
      return { transfer: declined, replayed: false };
    }

    assertAllowedTransition("risk_review", "authorized");
    await tx.update(transfers).set({ status: "authorized", authorizedAt: new Date(), updatedAt: new Date() }).where(eq(transfers.id, transferId));
    await reserveFunds(tx, { transferId, accountId: walletId, amountMinor: intent.amountMinor });
    await writeAudit(tx, {
      actorUserId: userId,
      actorType: "system",
      action: "funds_reserved",
      resource: "transfer",
      resourceId: transferId,
      requestId: intent.idempotencyKey,
      metadata: { amountMinor: intent.amountMinor, accountId: walletId },
    });

    assertAllowedTransition("authorized", "processing");
    await tx.update(transfers).set({ status: "processing", updatedAt: new Date() }).where(eq(transfers.id, transferId));
    await tx.insert(outboxEvents).values({
      id: crypto.randomUUID(),
      aggregateType: "transfer",
      aggregateId: transferId,
      eventType: "provider.transfer.requested",
      payloadHash: hashAuditMetadata({ reference, amountMinor: intent.amountMinor, currency: intent.currency, idempotencyKey: intent.idempotencyKey }),
      status: "pending",
      attemptCount: 0,
    });
    await writeAudit(tx, {
      actorUserId: userId,
      actorType: "system",
      action: "provider_dispatch_queued",
      resource: "transfer",
      resourceId: transferId,
      requestId: intent.idempotencyKey,
      metadata: { provider: SANDBOX_PROVIDER, outbox: "pending" },
    });

    const [processing] = await tx.select().from(transfers).where(eq(transfers.id, transferId)).limit(1);
    if (!processing) throw new Error("Transfer was not persisted");
    return { transfer: processing, replayed: false };
  });
}

export async function dispatchPendingSandboxOutbox(limit = 20) {
  const db = requiredDb(await getDb());
  const adapter = new SandboxBankAdapter();
  const pending = await db.select().from(outboxEvents)
    .where(and(eq(outboxEvents.status, "pending"), eq(outboxEvents.eventType, "provider.transfer.requested")))
    .orderBy(outboxEvents.createdAt)
    .limit(limit);

  let dispatched = 0;
  let unknown = 0;

  for (const event of pending) {
    const claimed = await db.transaction(async (tx) => {
      const claim = await tx.update(outboxEvents).set({
        status: "dispatching",
        claimedAt: new Date(),
        attemptCount: sql`${outboxEvents.attemptCount} + 1`,
        failureCode: null,
        updatedAt: new Date(),
      }).where(and(eq(outboxEvents.id, event.id), eq(outboxEvents.status, "pending"))).returning({ id: outboxEvents.id });
      if (claim.length !== 1) return null;

      const [candidate] = await tx.select().from(transfers).where(eq(transfers.id, event.aggregateId)).limit(1);
      if (!candidate || candidate.status !== "processing") {
        await tx.update(outboxEvents).set({
          status: "failed",
          failureCode: "transfer_not_dispatchable",
          updatedAt: new Date(),
        }).where(eq(outboxEvents.id, event.id));
        return null;
      }
      const transfer = await lockTransfer(tx, candidate.id);
      await tx.update(transfers).set({ providerSubmittedAt: new Date(), updatedAt: new Date() }).where(eq(transfers.id, transfer.id));
      return transfer;
    });
    if (!claimed) continue;

    try {
      const providerResult = await adapter.createTransfer({
        transferReference: claimed.reference,
        amountMinor: claimed.amountMinor,
        currency: "HNL",
        idempotencyKey: claimed.idempotencyKey,
      });

      await db.transaction(async (tx) => {
        const current = await lockTransfer(tx, claimed.id);
        if (current.status !== "processing" && current.status !== "unknown") {
          await tx.update(outboxEvents).set({
            status: "failed",
            failureCode: "transfer_not_dispatchable_after_provider_call",
            updatedAt: new Date(),
          }).where(eq(outboxEvents.id, event.id));
          return;
        }
        if (current.status === "unknown") {
          assertAllowedTransition("unknown", "processing");
        }
        await tx.update(transfers).set({
          status: "processing",
          providerReference: providerResult.providerReference,
          providerAcceptedAt: providerResult.acceptedAt,
          unknownAt: null,
          unknownReason: null,
          updatedAt: new Date(),
        }).where(eq(transfers.id, current.id));
        await tx.update(outboxEvents).set({
          status: "dispatched",
          dispatchedAt: new Date(),
          failureCode: null,
          updatedAt: new Date(),
        }).where(eq(outboxEvents.id, event.id));
        await writeAudit(tx, {
          actorUserId: null,
          actorType: "system",
          action: "provider_dispatch_completed",
          resource: "transfer",
          resourceId: current.id,
          requestId: event.id,
          metadata: { provider: adapter.name, providerReference: providerResult.providerReference },
        });
      });
      dispatched += 1;
    } catch (error) {
      await db.transaction(async (tx) => {
        const current = await lockTransfer(tx, claimed.id);
        if (current.status === "processing") {
          assertAllowedTransition("processing", "unknown");
          await tx.update(transfers).set({
            status: "unknown",
            unknownAt: new Date(),
            unknownReason: "provider_submission_outcome_unknown",
            updatedAt: new Date(),
          }).where(eq(transfers.id, current.id));
        }
        await tx.update(outboxEvents).set({
          status: "unknown",
          failureCode: "provider_submission_outcome_unknown",
          updatedAt: new Date(),
        }).where(eq(outboxEvents.id, event.id));
        await upsertReconciliation(tx, {
          transferId: current.id,
          providerReference: current.providerReference ?? `UNRESOLVED-${current.reference}`,
          expectedAmountMinor: current.amountMinor,
          reportedAmountMinor: null,
          status: "unknown",
        });
        await writeAudit(tx, {
          actorUserId: null,
          actorType: "system",
          action: "provider_dispatch_unknown",
          resource: "transfer",
          resourceId: current.id,
          requestId: event.id,
          metadata: { provider: adapter.name, errorClass: error instanceof Error ? error.name : "unknown" },
        });
      });
      unknown += 1;
    }
  }

  return { dispatched, unknown };
}

export async function processVerifiedProviderWebhook(webhook: ProviderWebhook, payloadHash: string) {
  const db = requiredDb(await getDb());
  return db.transaction(async (tx) => {
    const [prior] = await tx.select().from(providerWebhookEvents).where(and(
      eq(providerWebhookEvents.provider, SANDBOX_PROVIDER),
      eq(providerWebhookEvents.providerEventId, webhook.id),
    )).limit(1);
    if (prior) return { accepted: false, duplicate: true, reason: "duplicate_event" as const };

    const [candidate] = await tx.select().from(transfers).where(eq(transfers.reference, webhook.transferReference)).limit(1);
    if (!candidate) {
      await tx.insert(providerWebhookEvents).values({
        id: crypto.randomUUID(),
        provider: SANDBOX_PROVIDER,
        providerEventId: webhook.id,
        eventType: webhook.type,
        transferReference: webhook.transferReference,
        providerReference: webhook.providerReference,
        sequence: webhook.sequence,
        occurredAt: new Date(webhook.occurredAt),
        payloadHash,
        status: "rejected",
        reason: "unknown_transfer",
      });
      return { accepted: false, duplicate: false, reason: "unknown_transfer" as const };
    }

    let transfer = await lockTransfer(tx, candidate.id);
    if (transfer.providerReference && transfer.providerReference !== webhook.providerReference) {
      await tx.insert(providerWebhookEvents).values({
        id: crypto.randomUUID(),
        provider: SANDBOX_PROVIDER,
        providerEventId: webhook.id,
        eventType: webhook.type,
        transferReference: webhook.transferReference,
        providerReference: webhook.providerReference,
        sequence: webhook.sequence,
        occurredAt: new Date(webhook.occurredAt),
        payloadHash,
        status: "rejected",
        reason: "provider_reference_mismatch",
      });
      return { accepted: false, duplicate: false, reason: "provider_reference_mismatch" as const };
    }

    if (!transfer.providerReference) {
      await tx.update(transfers).set({
        providerReference: webhook.providerReference,
        providerAcceptedAt: new Date(webhook.occurredAt),
        updatedAt: new Date(),
      }).where(eq(transfers.id, transfer.id));
      transfer = { ...transfer, providerReference: webhook.providerReference };
    }

    const [newerEvent] = await tx.select().from(providerWebhookEvents).where(and(
      eq(providerWebhookEvents.provider, SANDBOX_PROVIDER),
      eq(providerWebhookEvents.transferReference, webhook.transferReference),
      sql`${providerWebhookEvents.sequence} >= ${webhook.sequence}`,
    )).limit(1);
    if (newerEvent) {
      await tx.insert(providerWebhookEvents).values({
        id: crypto.randomUUID(),
        provider: SANDBOX_PROVIDER,
        providerEventId: webhook.id,
        eventType: webhook.type,
        transferReference: webhook.transferReference,
        providerReference: webhook.providerReference,
        sequence: webhook.sequence,
        occurredAt: new Date(webhook.occurredAt),
        payloadHash,
        status: "ignored",
        reason: "out_of_order_event",
      });
      return { accepted: false, duplicate: false, reason: "out_of_order_event" as const };
    }

    try {
      if (webhook.type === "transfer.settled") {
        await settleTransfer(tx, transfer, webhook.providerReference, webhook.amountMinor);
        await tx.insert(providerWebhookEvents).values({
          id: crypto.randomUUID(), provider: SANDBOX_PROVIDER, providerEventId: webhook.id, eventType: webhook.type,
          transferReference: webhook.transferReference, providerReference: webhook.providerReference, sequence: webhook.sequence,
          occurredAt: new Date(webhook.occurredAt), payloadHash, status: "accepted",
        });
        await writeAudit(tx, {
          actorUserId: null, actorType: "provider", action: "provider_settlement_accepted", resource: "transfer",
          resourceId: transfer.id, requestId: webhook.id, metadata: { provider: SANDBOX_PROVIDER, amountMinor: webhook.amountMinor, sequence: webhook.sequence },
        });
        return { accepted: true, duplicate: false, reason: "settled" as const };
      }

      if (webhook.type === "transfer.failed") {
        await failTransfer(tx, transfer, webhook.providerReference, "provider_failed");
        await tx.insert(providerWebhookEvents).values({
          id: crypto.randomUUID(), provider: SANDBOX_PROVIDER, providerEventId: webhook.id, eventType: webhook.type,
          transferReference: webhook.transferReference, providerReference: webhook.providerReference, sequence: webhook.sequence,
          occurredAt: new Date(webhook.occurredAt), payloadHash, status: "accepted",
        });
        await writeAudit(tx, {
          actorUserId: null, actorType: "provider", action: "provider_failure_accepted", resource: "transfer",
          resourceId: transfer.id, requestId: webhook.id, metadata: { provider: SANDBOX_PROVIDER, sequence: webhook.sequence },
        });
        return { accepted: true, duplicate: false, reason: "failed" as const };
      }

      if (webhook.type === "transfer.reversed") {
        await reverseTransfer(tx, transfer, webhook.providerReference);
        await tx.insert(providerWebhookEvents).values({
          id: crypto.randomUUID(), provider: SANDBOX_PROVIDER, providerEventId: webhook.id, eventType: webhook.type,
          transferReference: webhook.transferReference, providerReference: webhook.providerReference, sequence: webhook.sequence,
          occurredAt: new Date(webhook.occurredAt), payloadHash, status: "accepted",
        });
        await writeAudit(tx, {
          actorUserId: null, actorType: "provider", action: "provider_reversal_accepted", resource: "transfer",
          resourceId: transfer.id, requestId: webhook.id, metadata: { provider: SANDBOX_PROVIDER, sequence: webhook.sequence },
        });
        return { accepted: true, duplicate: false, reason: "reversed" as const };
      }
    } catch (error) {
      const reason = error instanceof Error ? error.message : "provider_event_rejected";
      await tx.insert(providerWebhookEvents).values({
        id: crypto.randomUUID(), provider: SANDBOX_PROVIDER, providerEventId: webhook.id, eventType: webhook.type,
        transferReference: webhook.transferReference, providerReference: webhook.providerReference, sequence: webhook.sequence,
        occurredAt: new Date(webhook.occurredAt), payloadHash, status: "rejected", reason: reason.slice(0, 160),
      });
      await writeAudit(tx, {
        actorUserId: null, actorType: "provider", action: "provider_event_rejected", resource: "transfer",
        resourceId: transfer.id, requestId: webhook.id, metadata: { reason: reason.slice(0, 120) },
      });
      return { accepted: false, duplicate: false, reason: "provider_event_rejected" as const };
    }

    return { accepted: false, duplicate: false, reason: "unsupported_event" as const };
  });
}

export async function reconcilePendingSandboxTransfers(limit = 50) {
  const db = requiredDb(await getDb());
  const adapter = new SandboxBankAdapter();
  const candidates = await db.select().from(transfers)
    .where(inArray(transfers.status, ["processing", "unknown"]))
    .orderBy(transfers.updatedAt)
    .limit(limit);

  let checked = 0;
  let resolved = 0;

  for (const candidate of candidates) {
    let provider;
    try {
      provider = await adapter.reconcile({
        providerReference: candidate.providerReference,
        transferReference: candidate.reference,
        idempotencyKey: candidate.idempotencyKey,
        amountMinor: candidate.amountMinor,
        currency: "HNL",
      });
    } catch (error) {
      checked += 1;
      await db.transaction(async (tx) => {
        const transfer = await lockTransfer(tx, candidate.id);
        await upsertReconciliation(tx, {
          transferId: transfer.id,
          providerReference: transfer.providerReference ?? `UNRESOLVED-${transfer.reference}`,
          expectedAmountMinor: transfer.amountMinor,
          reportedAmountMinor: null,
          status: "unknown",
        });
        await writeAudit(tx, {
          actorUserId: null,
          actorType: "system",
          action: "provider_reconciliation_unavailable",
          resource: "transfer",
          resourceId: transfer.id,
          requestId: crypto.randomUUID(),
          metadata: { errorClass: error instanceof Error ? error.name : "unknown" },
        });
      });
      continue;
    }

    checked += 1;
    await db.transaction(async (tx) => {
      const transfer = await lockTransfer(tx, candidate.id);
      const providerReference = provider.providerReference ?? transfer.providerReference ?? `UNRESOLVED-${transfer.reference}`;

      if (provider.status === "settled") {
        await settleTransfer(tx, transfer, providerReference, provider.amountMinor ?? transfer.amountMinor);
        resolved += 1;
      } else if (provider.status === "failed") {
        await failTransfer(tx, transfer, providerReference, "provider_reconciled_failed");
        resolved += 1;
      } else if (provider.status === "reversed") {
        if (transfer.status === "settled") {
          await reverseTransfer(tx, transfer, providerReference);
          resolved += 1;
        } else {
          await upsertReconciliation(tx, {
            transferId: transfer.id,
            providerReference,
            expectedAmountMinor: transfer.amountMinor,
            reportedAmountMinor: provider.amountMinor ?? null,
            status: "status_mismatch",
          });
        }
      } else {
        if (transfer.status === "unknown" && provider.status === "processing") {
          assertAllowedTransition("unknown", "processing");
          await tx.update(transfers).set({
            status: "processing",
            providerReference,
            unknownAt: null,
            unknownReason: null,
            updatedAt: new Date(),
          }).where(eq(transfers.id, transfer.id));
        }
        await upsertReconciliation(tx, {
          transferId: transfer.id,
          providerReference,
          expectedAmountMinor: transfer.amountMinor,
          reportedAmountMinor: provider.amountMinor ?? null,
          status: "unknown",
        });
      }

      await writeAudit(tx, {
        actorUserId: null,
        actorType: "system",
        action: "provider_reconciliation_checked",
        resource: "transfer",
        resourceId: transfer.id,
        requestId: crypto.randomUUID(),
        metadata: { providerStatus: provider.status, providerReference },
      });
    });
  }

  return { checked, resolved };
}

export async function createPaymentRequest(userId: number, input: {
  amountMinor: number;
  currency: "HNL";
  recipientHandle: string;
  note?: string;
  idempotencyKey: string;
}) {
  const db = requiredDb(await getDb());
  assertPositiveMinorAmount(input.amountMinor);
  const recipientHandle = input.recipientHandle.trim().toLowerCase();
  const requestFingerprint = hashAuditMetadata({
    amountMinor: input.amountMinor,
    currency: input.currency,
    recipientHandle,
    note: input.note?.trim() ?? "",
  });

  return db.transaction(async (tx) => {
    const prior = await tx.select().from(paymentRequests)
      .where(and(eq(paymentRequests.requesterUserId, userId), eq(paymentRequests.idempotencyKey, input.idempotencyKey))).limit(1);
    if (prior[0]) {
      assertIdempotency(prior[0].requestFingerprint, requestFingerprint);
      return { request: prior[0], replayed: true };
    }

    const id = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    await tx.insert(paymentRequests).values({
      id,
      requesterUserId: userId,
      recipientHandle,
      amountMinor: input.amountMinor,
      currency: input.currency,
      note: input.note?.trim() || null,
      status: "open",
      idempotencyKey: input.idempotencyKey,
      requestFingerprint,
      expiresAt,
    });
    await writeAudit(tx, {
      actorUserId: userId,
      actorType: "user",
      action: "payment_request_created",
      resource: "payment_request",
      resourceId: id,
      requestId: input.idempotencyKey,
      metadata: { amountMinor: input.amountMinor, currency: input.currency, expiresAt: expiresAt.toISOString() },
    });
    const [paymentRequest] = await tx.select().from(paymentRequests).where(eq(paymentRequests.id, id)).limit(1);
    if (!paymentRequest) throw new Error("Payment request was not persisted");
    return { request: paymentRequest, replayed: false };
  });
}

export async function cancelPaymentRequest(userId: number, paymentRequestId: string) {
  const db = requiredDb(await getDb());
  return db.transaction(async (tx) => {
    const [request] = await tx.select().from(paymentRequests)
      .where(and(eq(paymentRequests.id, paymentRequestId), eq(paymentRequests.requesterUserId, userId))).limit(1);
    if (!request) throw new Error("Payment request was not found for this user");
    if (request.status !== "open") throw new Error("Only open payment requests can be canceled");
    if (request.expiresAt.getTime() <= Date.now()) {
      await tx.update(paymentRequests).set({ status: "expired" }).where(eq(paymentRequests.id, request.id));
      throw new Error("Payment request has expired");
    }
    await tx.update(paymentRequests).set({ status: "canceled", canceledByUserId: userId, canceledAt: new Date() }).where(eq(paymentRequests.id, request.id));
    await writeAudit(tx, { actorUserId: userId, actorType: "user", action: "payment_request_canceled", resource: "payment_request", resourceId: request.id, requestId: request.id, metadata: { previousStatus: "open" } });
    return { success: true } as const;
  });
}

export async function expireOpenPaymentRequests() {
  const db = requiredDb(await getDb());
  const result = await db.update(paymentRequests).set({ status: "expired", updatedAt: new Date() })
    .where(and(eq(paymentRequests.status, "open"), lt(paymentRequests.expiresAt, new Date())))
    .returning({ id: paymentRequests.id });
  return { affected: result.length };
}

export async function setTransferControl(adminUserId: number, enabled: boolean, reason: string) {
  const db = requiredDb(await getDb());
  await db.transaction(async (tx) => {
    await tx.insert(operationalControls).values({ control: "transfers_enabled", enabled, reason, changedByUserId: adminUserId, updatedAt: new Date() })
      .onConflictDoUpdate({ target: operationalControls.control, set: { enabled, reason, changedByUserId: adminUserId, updatedAt: new Date() } });
    await writeAudit(tx, { actorUserId: adminUserId, actorType: "admin", action: enabled ? "transfers_resumed" : "transfers_paused", resource: "operational_control", resourceId: "transfers_enabled", requestId: crypto.randomUUID(), metadata: { reason } });
  });
}

export async function listAdminOperations() {
  const db = requiredDb(await getDb());
  const [recentTransfers, risks, reconciliations, controls, audit] = await Promise.all([
    db.select().from(transfers).orderBy(desc(transfers.createdAt)).limit(30),
    db.select().from(riskEvents).orderBy(desc(riskEvents.createdAt)).limit(20),
    db.select().from(reconciliationItems).orderBy(desc(reconciliationItems.createdAt)).limit(20),
    db.select().from(operationalControls),
    db.select().from(auditEvents).orderBy(desc(auditEvents.createdAt)).limit(30),
  ]);
  return { recentTransfers, risks, reconciliations, controls, audit };
}
