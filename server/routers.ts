import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { COOKIE_NAME } from "@shared/const";
import {
  cancelPaymentRequest,
  createPaymentRequest,
  createSandboxTransfer,
  dispatchPendingSandboxOutbox,
  getFinancialDashboard,
  getSecurityOverview,
  listAdminOperations,
  revokeOtherSecuritySessions,
  revokeSecuritySession,
  revokeTrustedDevice,
  setTransferControl,
  setUserPin,
  startTransferVerification,
  verifyTransferChallenge,
} from "./db";
import { FinancialInvariantError } from "./financial/domain";
import {
  getCurrentDeviceTrust,
  requireTrustedSecurityContext,
  requireTrustedTransferSession,
  startDeviceEnrollment,
  verifyDeviceEnrollment,
} from "./security/deviceTrust";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { adminProcedure, protectedProcedure, publicProcedure, router } from "./_core/trpc";

const handleSchema = z.string().trim().min(2).max(80).regex(/^@?[a-zA-Z0-9_.-]+$/, "Use a valid @usuario");
const transferInput = z.object({
  amountMinor: z.number().int().positive().max(100_000),
  currency: z.literal("HNL"),
  recipientHandle: handleSchema,
  idempotencyKey: z.string().min(12).max(128).regex(/^[a-zA-Z0-9_-]+$/),
});
const securityContextInput = z.object({
  deviceFingerprint: z.string().min(16).max(128).regex(/^[a-zA-Z0-9_-]+$/),
  sessionFingerprint: z.string().min(16).max(128).regex(/^[a-zA-Z0-9_-]+$/),
  deviceLabel: z.string().trim().min(2).max(100),
  platform: z.string().trim().min(2).max(80),
});
const secureTransferInput = transferInput.extend({
  verificationChallengeId: z.string().uuid(),
  sessionFingerprint: z.string().min(16).max(128).regex(/^[a-zA-Z0-9_-]+$/),
});

function financialError(error: unknown): never {
  if (error instanceof FinancialInvariantError) {
    throw new TRPCError({ code: "CONFLICT", message: error.message });
  }
  if (error instanceof Error) {
    if (error.message.includes("Insufficient")) throw new TRPCError({ code: "PRECONDITION_FAILED", message: error.message });
    if (error.message.includes("paused")) throw new TRPCError({ code: "PRECONDITION_FAILED", message: error.message });
    if (error.message.includes("valid recipient")) throw new TRPCError({ code: "BAD_REQUEST", message: error.message });
    if (/(PIN|código|desafío|sesión|dispositivo|Configura|límite|confiable|enfriamiento)/i.test(error.message)) throw new TRPCError({ code: "PRECONDITION_FAILED", message: error.message });
  }
  throw error;
}

export const appRouter = router({
  system: systemRouter,
  auth: router({
    me: publicProcedure.query((opts) => opts.ctx.user),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return { success: true } as const;
    }),
  }),
  finance: router({
    dashboard: protectedProcedure.query(async ({ ctx }) => {
      try {
        return await getFinancialDashboard(ctx.user.id);
      } catch (error) {
        return financialError(error);
      }
    }),
    createTransfer: protectedProcedure.input(secureTransferInput).mutation(async ({ ctx, input }) => {
      try {
        await requireTrustedTransferSession(ctx.user.id, input.sessionFingerprint);
        return await createSandboxTransfer(ctx.user.id, input);
      } catch (error) {
        return financialError(error);
      }
    }),
    createPaymentRequest: protectedProcedure.input(transferInput.extend({ note: z.string().trim().max(140).optional() })).mutation(async ({ ctx, input }) => {
      try {
        const result = await createPaymentRequest(ctx.user.id, input);
        return { request: result.paymentRequest, replayed: result.replayed };
      } catch (error) {
        return financialError(error);
      }
    }),
    cancelPaymentRequest: protectedProcedure.input(z.object({ paymentRequestId: z.string().uuid() })).mutation(async ({ ctx, input }) => {
      try {
        return await cancelPaymentRequest(ctx.user.id, input.paymentRequestId);
      } catch (error) {
        return financialError(error);
      }
    }),
  }),
  security: router({
    overview: protectedProcedure.input(securityContextInput).query(async ({ ctx, input }) => {
      try {
        const current = await getCurrentDeviceTrust(ctx.user.id, input);
        const overview = await getSecurityOverview(ctx.user.id, input);
        return {
          ...overview,
          currentDeviceStatus: current.status,
          currentDeviceEligibleAt: current.eligibleAt,
        };
      } catch (error) {
        return financialError(error);
      }
    }),
    setPin: protectedProcedure.input(securityContextInput.extend({ pin: z.string().regex(/^\d{6}$/), currentPin: z.string().regex(/^\d{6}$/).optional() })).mutation(async ({ ctx, input }) => {
      try {
        return await setUserPin(ctx.user.id, input, input.pin, input.currentPin);
      } catch (error) {
        return financialError(error);
      }
    }),
    startDeviceEnrollment: protectedProcedure.input(securityContextInput).mutation(async ({ ctx, input }) => {
      try {
        return await startDeviceEnrollment(ctx.user.id, input);
      } catch (error) {
        return financialError(error);
      }
    }),
    verifyDeviceEnrollment: protectedProcedure.input(securityContextInput.extend({ challengeId: z.string().uuid(), pin: z.string().regex(/^\d{6}$/), code: z.string().regex(/^\d{6}$/) })).mutation(async ({ ctx, input }) => {
      try {
        return await verifyDeviceEnrollment(ctx.user.id, input, input.challengeId, input.pin, input.code);
      } catch (error) {
        return financialError(error);
      }
    }),
    startTransferVerification: protectedProcedure.input(securityContextInput).mutation(async ({ ctx, input }) => {
      try {
        await requireTrustedSecurityContext(ctx.user.id, input);
        return await startTransferVerification(ctx.user.id, input);
      } catch (error) {
        return financialError(error);
      }
    }),
    verifyTransfer: protectedProcedure.input(securityContextInput.extend({ challengeId: z.string().uuid(), pin: z.string().regex(/^\d{6}$/), code: z.string().regex(/^\d{6}$/) })).mutation(async ({ ctx, input }) => {
      try {
        await requireTrustedSecurityContext(ctx.user.id, input);
        return await verifyTransferChallenge(ctx.user.id, input, input.challengeId, input.pin, input.code);
      } catch (error) {
        return financialError(error);
      }
    }),
    revokeSession: protectedProcedure.input(z.object({ sessionId: z.string().uuid() })).mutation(async ({ ctx, input }) => {
      try {
        return await revokeSecuritySession(ctx.user.id, input.sessionId);
      } catch (error) {
        return financialError(error);
      }
    }),
    revokeOtherSessions: protectedProcedure.input(securityContextInput).mutation(async ({ ctx, input }) => {
      try {
        return await revokeOtherSecuritySessions(ctx.user.id, input);
      } catch (error) {
        return financialError(error);
      }
    }),
    revokeDevice: protectedProcedure.input(z.object({ deviceId: z.string().uuid() })).mutation(async ({ ctx, input }) => {
      try {
        return await revokeTrustedDevice(ctx.user.id, input.deviceId);
      } catch (error) {
        return financialError(error);
      }
    }),
  }),
  financeAdmin: router({
    overview: adminProcedure.query(async () => {
      try {
        return await listAdminOperations();
      } catch (error) {
        return financialError(error);
      }
    }),
    setTransferControl: adminProcedure.input(z.object({ enabled: z.boolean(), reason: z.string().trim().min(8).max(180) })).mutation(async ({ ctx, input }) => {
      try {
        await setTransferControl(ctx.user.id, input.enabled, input.reason);
        return { success: true } as const;
      } catch (error) {
        return financialError(error);
      }
    }),
    dispatchSandboxOutbox: adminProcedure.input(z.object({ limit: z.number().int().min(1).max(50).default(20) })).mutation(async ({ ctx, input }) => {
      try {
        return await dispatchPendingSandboxOutbox(input.limit);
      } catch (error) {
        return financialError(error);
      }
    }),
  }),
});

export type AppRouter = typeof appRouter;
