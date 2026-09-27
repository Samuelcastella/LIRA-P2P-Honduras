import { randomBytes, randomInt, scryptSync, timingSafeEqual } from "node:crypto";

const SCRYPT_KEY_LENGTH = 64;

/** Explicit sandbox guardrails; not a production risk policy or regulatory limit. */
export const SANDBOX_SECURITY_POLICY = {
  maxPinAttempts: 5,
  pinLockDurationMs: 15 * 60 * 1000,
  maxOtpAttempts: 5,
  otpLifetimeMs: 5 * 60 * 1000,
  maxSingleTransferMinor: 100_000,
  maxDailyOutgoingMinor: 200_000,
} as const;

function derive(value: string, salt: string) {
  return scryptSync(value, salt, SCRYPT_KEY_LENGTH).toString("hex");
}

export function hashSecret(value: string) {
  const salt = randomBytes(16).toString("hex");
  return `scrypt$${salt}$${derive(value, salt)}`;
}

export function verifySecret(value: string, encoded: string | null | undefined) {
  if (!encoded) return false;
  const [scheme, salt, stored] = encoded.split("$");
  if (scheme !== "scrypt" || !salt || !stored) return false;
  const candidate = Buffer.from(derive(value, salt), "hex");
  const expected = Buffer.from(stored, "hex");
  return candidate.length === expected.length && timingSafeEqual(candidate, expected);
}

export function assertPin(pin: string) {
  if (!/^\d{6}$/.test(pin)) throw new Error("El PIN debe contener exactamente 6 dígitos");
}

export function assertOtp(code: string) {
  if (!/^\d{6}$/.test(code)) throw new Error("El código debe contener 6 dígitos");
}

export function createOtpCode() {
  return String(randomInt(100000, 1_000_000));
}

export function isExpired(date: Date, now = new Date()) {
  return date.getTime() <= now.getTime();
}

export function nextPinFailureState(previousAttempts: number, now = new Date()) {
  const failedPinAttempts = previousAttempts + 1;
  const lockedUntil = failedPinAttempts >= SANDBOX_SECURITY_POLICY.maxPinAttempts
    ? new Date(now.getTime() + SANDBOX_SECURITY_POLICY.pinLockDurationMs)
    : null;
  return { failedPinAttempts, lockedUntil };
}

export function assertDistinctPin(currentPin: string, newPin: string) {
  if (currentPin === newPin) throw new Error("El nuevo PIN debe ser diferente del PIN actual");
}

export function assertSandboxTransferWithinSingleLimit(amountMinor: number) {
  if (amountMinor > SANDBOX_SECURITY_POLICY.maxSingleTransferMinor) {
    throw new Error("El monto supera el límite por transferencia del sandbox");
  }
}

export function assertSandboxDailyLimit(dailyOutgoingMinor: number, requestedAmountMinor: number) {
  if (dailyOutgoingMinor + requestedAmountMinor > SANDBOX_SECURITY_POLICY.maxDailyOutgoingMinor) {
    throw new Error("El monto supera el límite diario del sandbox");
  }
}
