import { and, eq } from "drizzle-orm";
import { auditEvents, otpChallenges, securitySessions, trustedDevices, userSecurityProfiles } from "../../drizzle/schema";
import { getDb, type SecurityClientContext } from "../db";
import { hashAuditMetadata } from "../financial/domain";
import {
  assertDeviceEligibleForTrust,
  assertOtp,
  assertPin,
  assertTrustedDeviceState,
  createOtpCode,
  deviceTrustEligibleAt,
  hashSecret,
  isExpired,
  nextPinFailureState,
  SANDBOX_SECURITY_POLICY,
  verifySecret,
} from "./domain";

function requiredDb<T>(db: T | null): T {
  if (!db) throw new Error("Database is unavailable; sandbox security operations cannot proceed");
  return db;
}

function securityFingerprint(value: string) {
  return hashAuditMetadata({ value });
}

async function writeSecurityAudit(db: any, params: {
  userId: number;
  action: string;
  resource: string;
  resourceId: string;
  requestId: string;
  metadata?: Record<string, unknown>;
}) {
  await db.insert(auditEvents).values({
    id: crypto.randomUUID(),
    actorUserId: params.userId,
    actorType: "user",
    action: params.action,
    resource: params.resource,
    resourceId: params.resourceId,
    requestId: params.requestId,
    metadataHash: hashAuditMetadata(params.metadata ?? {}),
  });
}

async function ensureTrustContext(tx: any, userId: number, context: SecurityClientContext) {
  const deviceFingerprintHash = securityFingerprint(context.deviceFingerprint);
  const sessionFingerprintHash = securityFingerprint(context.sessionFingerprint);

  let [device] = await tx.select().from(trustedDevices).where(and(
    eq(trustedDevices.userId, userId),
    eq(trustedDevices.fingerprintHash, deviceFingerprintHash),
  )).limit(1);

  if (!device) {
    const requestedAt = new Date();
    const deviceId = crypto.randomUUID();
    await tx.insert(trustedDevices).values({
      id: deviceId,
      userId,
      fingerprintHash: deviceFingerprintHash,
      label: context.deviceLabel,
      platform: context.platform,
      status: "new",
      enrollmentRequestedAt: requestedAt,
      eligibleAt: deviceTrustEligibleAt(requestedAt),
    });
    [device] = await tx.select().from(trustedDevices).where(eq(trustedDevices.id, deviceId)).limit(1);
    if (device) {
      await writeSecurityAudit(tx, {
        userId,
        action: "trusted_device_discovered",
        resource: "trusted_device",
        resourceId: device.id,
        requestId: device.id,
        metadata: { status: "new", sandbox: true },
      });
    }
  }

  if (!device || device.revokedAt || device.status === "revoked") {
    throw new Error("Este dispositivo fue revocado; usa un dispositivo de confianza para continuar");
  }

  if (device.status === "new" && !device.eligibleAt) {
    const eligibleAt = deviceTrustEligibleAt(device.enrollmentRequestedAt ?? device.createdAt ?? new Date());
    await tx.update(trustedDevices).set({ eligibleAt, updatedAt: new Date() }).where(eq(trustedDevices.id, device.id));
    device = { ...device, eligibleAt };
  }

  await tx.update(trustedDevices).set({
    label: context.deviceLabel,
    platform: context.platform,
    lastUsedAt: new Date(),
    updatedAt: new Date(),
  }).where(eq(trustedDevices.id, device.id));

  let [session] = await tx.select().from(securitySessions).where(and(
    eq(securitySessions.userId, userId),
    eq(securitySessions.sessionFingerprintHash, sessionFingerprintHash),
  )).limit(1);

  if (!session) {
    const sessionId = crypto.randomUUID();
    await tx.insert(securitySessions).values({
      id: sessionId,
      userId,
      deviceId: device.id,
      sessionFingerprintHash,
      label: context.deviceLabel,
      authStrength: "basic",
    });
    [session] = await tx.select().from(securitySessions).where(eq(securitySessions.id, sessionId)).limit(1);
  }

  if (!session || session.revokedAt) {
    throw new Error("Esta sesión fue revocada; inicia una nueva sesión de seguridad");
  }

  await tx.update(securitySessions).set({
    label: context.deviceLabel,
    lastSeenAt: new Date(),
    updatedAt: new Date(),
  }).where(eq(securitySessions.id, session.id));

  return { device, session };
}

async function issueChallenge(tx: any, userId: number, sessionId: string, purpose: "transfer" | "device_enrollment") {
  const code = createOtpCode();
  const id = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + SANDBOX_SECURITY_POLICY.otpLifetimeMs);
  await tx.insert(otpChallenges).values({
    id,
    userId,
    sessionId,
    purpose,
    codeHash: hashSecret(code),
    status: "issued",
    attempts: 0,
    expiresAt,
  });
  await writeSecurityAudit(tx, {
    userId,
    action: `${purpose}_otp_issued`,
    resource: "otp_challenge",
    resourceId: id,
    requestId: id,
    metadata: { purpose, expiresAt: expiresAt.toISOString(), sandbox: true },
  });
  return { challengeId: id, expiresAt, sandboxCode: code };
}

async function verifyChallengeWithPin(
  tx: any,
  userId: number,
  sessionId: string,
  challengeId: string,
  purpose: "transfer" | "device_enrollment",
  pin: string,
  code: string,
) {
  assertPin(pin);
  assertOtp(code);
  const [profile] = await tx.select().from(userSecurityProfiles).where(eq(userSecurityProfiles.userId, userId)).limit(1);
  if (!profile?.pinHash) throw new Error("Configura un PIN antes de continuar");
  if (profile.lockedUntil && !isExpired(profile.lockedUntil)) {
    throw new Error("El PIN está bloqueado temporalmente por intentos fallidos");
  }
  if (!verifySecret(pin, profile.pinHash)) {
    const next = nextPinFailureState(profile.failedPinAttempts);
    await tx.update(userSecurityProfiles).set({ ...next, updatedAt: new Date() }).where(eq(userSecurityProfiles.userId, userId));
    throw new Error(next.lockedUntil ? "PIN bloqueado durante 15 minutos por intentos fallidos" : "PIN incorrecto");
  }

  const [challenge] = await tx.select().from(otpChallenges).where(and(
    eq(otpChallenges.id, challengeId),
    eq(otpChallenges.userId, userId),
    eq(otpChallenges.sessionId, sessionId),
    eq(otpChallenges.purpose, purpose),
  )).limit(1);
  if (!challenge) throw new Error("El desafío de seguridad no pertenece a esta sesión");
  if (challenge.status !== "issued" || isExpired(challenge.expiresAt)) {
    if (challenge.status === "issued") {
      await tx.update(otpChallenges).set({ status: "expired" }).where(eq(otpChallenges.id, challenge.id));
    }
    throw new Error("El código expiró o ya fue usado; solicita uno nuevo");
  }
  if (!verifySecret(code, challenge.codeHash)) {
    const attempts = challenge.attempts + 1;
    await tx.update(otpChallenges).set({
      attempts,
      status: attempts >= SANDBOX_SECURITY_POLICY.maxOtpAttempts ? "locked" : "issued",
    }).where(eq(otpChallenges.id, challenge.id));
    throw new Error(attempts >= SANDBOX_SECURITY_POLICY.maxOtpAttempts
      ? "Código bloqueado por demasiados intentos"
      : "Código de verificación incorrecto");
  }

  await tx.update(userSecurityProfiles).set({ failedPinAttempts: 0, lockedUntil: null, updatedAt: new Date() }).where(eq(userSecurityProfiles.userId, userId));
  await tx.update(otpChallenges).set({ status: "verified", verifiedAt: new Date() }).where(eq(otpChallenges.id, challenge.id));
  await tx.update(securitySessions).set({ authStrength: "strong", updatedAt: new Date() }).where(eq(securitySessions.id, sessionId));
  return challenge;
}

export async function getCurrentDeviceTrust(userId: number, context: SecurityClientContext) {
  const db = requiredDb(await getDb());
  return db.transaction(async (tx) => {
    const current = await ensureTrustContext(tx, userId, context);
    return {
      deviceId: current.device.id,
      status: current.device.status,
      eligibleAt: current.device.eligibleAt,
      sessionId: current.session.id,
    };
  });
}

export async function requireTrustedSecurityContext(userId: number, context: SecurityClientContext) {
  const db = requiredDb(await getDb());
  return db.transaction(async (tx) => {
    const current = await ensureTrustContext(tx, userId, context);
    assertTrustedDeviceState(current.device.status);
    return { deviceId: current.device.id, sessionId: current.session.id };
  });
}

export async function requireTrustedTransferSession(userId: number, sessionFingerprint: string) {
  const db = requiredDb(await getDb());
  const sessionFingerprintHash = securityFingerprint(sessionFingerprint);
  const [session] = await db.select().from(securitySessions).where(and(
    eq(securitySessions.userId, userId),
    eq(securitySessions.sessionFingerprintHash, sessionFingerprintHash),
  )).limit(1);
  if (!session || session.revokedAt) throw new Error("La sesión de seguridad no está activa");
  const [device] = await db.select().from(trustedDevices).where(eq(trustedDevices.id, session.deviceId)).limit(1);
  if (!device || device.revokedAt || device.status === "revoked") throw new Error("El dispositivo de la sesión no está activo");
  assertTrustedDeviceState(device.status);
  return { deviceId: device.id, sessionId: session.id };
}

export async function startDeviceEnrollment(userId: number, context: SecurityClientContext) {
  const db = requiredDb(await getDb());
  return db.transaction(async (tx) => {
    const current = await ensureTrustContext(tx, userId, context);
    if (current.device.status === "trusted") {
      return { alreadyTrusted: true as const, deviceId: current.device.id };
    }
    const [profile] = await tx.select().from(userSecurityProfiles).where(eq(userSecurityProfiles.userId, userId)).limit(1);
    if (!profile?.pinHash) throw new Error("Configura tu PIN antes de verificar este dispositivo");

    const requestedAt = new Date();
    const eligibleAt = current.device.eligibleAt ?? deviceTrustEligibleAt(requestedAt);
    await tx.update(trustedDevices).set({
      status: "pending",
      eligibleAt,
      updatedAt: new Date(),
    }).where(eq(trustedDevices.id, current.device.id));

    const challenge = await issueChallenge(tx, userId, current.session.id, "device_enrollment");
    await writeSecurityAudit(tx, {
      userId,
      action: "device_enrollment_requested",
      resource: "trusted_device",
      resourceId: current.device.id,
      requestId: challenge.challengeId,
      metadata: { eligibleAt: eligibleAt.toISOString() },
    });
    return { ...challenge, alreadyTrusted: false as const, deviceId: current.device.id, eligibleAt };
  });
}

export async function verifyDeviceEnrollment(
  userId: number,
  context: SecurityClientContext,
  challengeId: string,
  pin: string,
  code: string,
) {
  const db = requiredDb(await getDb());
  return db.transaction(async (tx) => {
    const current = await ensureTrustContext(tx, userId, context);
    if (current.device.status === "trusted") return { success: true, alreadyTrusted: true } as const;
    if (current.device.status !== "pending") throw new Error("El dispositivo no tiene una verificación pendiente");
    assertDeviceEligibleForTrust(current.device.eligibleAt);

    const challenge = await verifyChallengeWithPin(tx, userId, current.session.id, challengeId, "device_enrollment", pin, code);
    await tx.update(otpChallenges).set({ status: "consumed", consumedAt: new Date() }).where(eq(otpChallenges.id, challenge.id));
    await tx.update(trustedDevices).set({
      status: "trusted",
      trustedAt: new Date(),
      trustMethod: "pin+otp+cooling_period",
      updatedAt: new Date(),
    }).where(eq(trustedDevices.id, current.device.id));
    await writeSecurityAudit(tx, {
      userId,
      action: "device_trusted",
      resource: "trusted_device",
      resourceId: current.device.id,
      requestId: challenge.id,
      metadata: { method: "pin+otp+cooling_period" },
    });
    return { success: true, alreadyTrusted: false } as const;
  });
}
