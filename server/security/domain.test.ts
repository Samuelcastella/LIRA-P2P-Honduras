import { describe, expect, it } from "vitest";
import {
  assertDeviceEligibleForTrust,
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
} from "./domain";

describe("sandbox identity primitives", () => {
  it("hashes and verifies a six-digit PIN without retaining plaintext", () => {
    const encoded = hashSecret("482916");
    expect(encoded).toMatch(/^scrypt\$[a-f0-9]{32}\$[a-f0-9]{128}$/);
    expect(encoded).not.toContain("482916");
    expect(verifySecret("482916", encoded)).toBe(true);
    expect(verifySecret("000000", encoded)).toBe(false);
  });

  it("accepts only six-digit PINs and OTP codes", () => {
    expect(() => assertPin("123456")).not.toThrow();
    expect(() => assertOtp("654321")).not.toThrow();
    expect(() => assertPin("12345")).toThrow();
    expect(() => assertPin("abcdef")).toThrow();
    expect(() => assertOtp("1234567")).toThrow();
  });

  it("creates a six-digit code and detects expiry", () => {
    expect(createOtpCode()).toMatch(/^\d{6}$/);
    expect(isExpired(new Date(Date.now() - 1))).toBe(true);
    expect(isExpired(new Date(Date.now() + 60_000))).toBe(false);
  });

  it("locks only after the configured number of failed PIN attempts", () => {
    const now = new Date("2026-09-26T12:00:00.000Z");
    expect(nextPinFailureState(SANDBOX_SECURITY_POLICY.maxPinAttempts - 2, now)).toEqual({
      failedPinAttempts: SANDBOX_SECURITY_POLICY.maxPinAttempts - 1,
      lockedUntil: null,
    });
    expect(nextPinFailureState(SANDBOX_SECURITY_POLICY.maxPinAttempts - 1, now)).toEqual({
      failedPinAttempts: SANDBOX_SECURITY_POLICY.maxPinAttempts,
      lockedUntil: new Date(now.getTime() + SANDBOX_SECURITY_POLICY.pinLockDurationMs),
    });
  });

  it("rejects unchanged PINs and amounts above sandbox safety limits", () => {
    expect(() => assertDistinctPin("123456", "123456")).toThrow("diferente");
    expect(() => assertDistinctPin("123456", "654321")).not.toThrow();
    expect(() => assertSandboxTransferWithinSingleLimit(SANDBOX_SECURITY_POLICY.maxSingleTransferMinor)).not.toThrow();
    expect(() => assertSandboxTransferWithinSingleLimit(SANDBOX_SECURITY_POLICY.maxSingleTransferMinor + 1)).toThrow("límite");
    expect(() => assertSandboxDailyLimit(SANDBOX_SECURITY_POLICY.maxDailyOutgoingMinor - 100, 100)).not.toThrow();
    expect(() => assertSandboxDailyLimit(SANDBOX_SECURITY_POLICY.maxDailyOutgoingMinor - 100, 101)).toThrow("límite");
  });

  it("does not trust a device immediately and enforces a cooling period", () => {
    const requestedAt = new Date("2026-09-26T12:00:00.000Z");
    const eligibleAt = deviceTrustEligibleAt(requestedAt);
    expect(eligibleAt.getTime() - requestedAt.getTime()).toBe(SANDBOX_SECURITY_POLICY.deviceTrustCoolingPeriodMs);
    expect(() => assertDeviceEligibleForTrust(eligibleAt, new Date("2026-09-26T12:30:00.000Z"))).toThrow("enfriamiento");
    expect(() => assertDeviceEligibleForTrust(eligibleAt, new Date("2026-09-26T13:00:00.000Z"))).not.toThrow();
    expect(() => assertTrustedDeviceState("new")).toThrow("confiable");
    expect(() => assertTrustedDeviceState("pending")).toThrow("confiable");
    expect(() => assertTrustedDeviceState("trusted")).not.toThrow();
  });
});
