import {
  bigint,
  index,
  int,
  mysqlEnum,
  mysqlTable,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from "drizzle-orm/mysql-core";

/** Core identity record managed through Manus OAuth. */
export const users = mysqlTable("users", {
  id: int("id").autoincrement().primaryKey(),
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

/** Credential metadata only. PIN values and OTP codes are never persisted in plaintext. */
export const userSecurityProfiles = mysqlTable("user_security_profiles", {
  userId: int("userId").primaryKey().references(() => users.id),
  pinHash: varchar("pinHash", { length: 255 }),
  failedPinAttempts: int("failedPinAttempts").default(0).notNull(),
  lockedUntil: timestamp("lockedUntil"),
  pinUpdatedAt: timestamp("pinUpdatedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

/** Atomic per-day intent reservation used to enforce sandbox velocity limits. */
export const dailyTransferControls = mysqlTable(
  "daily_transfer_controls",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    userId: int("userId").notNull().references(() => users.id),
    periodStart: timestamp("periodStart").notNull(),
    attemptedMinor: bigint("attemptedMinor", { mode: "number" }).default(0).notNull(),
    attemptCount: int("attemptCount").default(0).notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  (table) => [
    uniqueIndex("daily_transfer_control_user_period_unique").on(table.userId, table.periodStart),
    index("daily_transfer_control_user_idx").on(table.userId, table.periodStart),
  ],
);

/** Browser/device fingerprints are discovery signals, never automatic trust. */
export const trustedDevices = mysqlTable(
  "trusted_devices",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    userId: int("userId").notNull().references(() => users.id),
    fingerprintHash: varchar("fingerprintHash", { length: 64 }).notNull(),
    label: varchar("label", { length: 100 }).notNull(),
    platform: varchar("platform", { length: 80 }).notNull(),
    status: mysqlEnum("device_trust_status", ["new", "pending", "trusted", "restricted", "revoked"]).default("new").notNull(),
    enrollmentRequestedAt: timestamp("enrollmentRequestedAt").defaultNow().notNull(),
    eligibleAt: timestamp("eligibleAt"),
    trustedAt: timestamp("trustedAt"),
    trustMethod: varchar("trustMethod", { length: 80 }),
    lastUsedAt: timestamp("lastUsedAt").defaultNow().notNull(),
    revokedAt: timestamp("revokedAt"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  (table) => [
    uniqueIndex("trusted_device_user_fingerprint_unique").on(table.userId, table.fingerprintHash),
    index("trusted_device_user_idx").on(table.userId, table.lastUsedAt),
    index("trusted_device_status_idx").on(table.userId, table.status),
  ],
);

/** Sandbox session controls bound to a device identifier; revocation gates sensitive actions. */
export const securitySessions = mysqlTable(
  "security_sessions",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    userId: int("userId").notNull().references(() => users.id),
    deviceId: varchar("deviceId", { length: 36 }).notNull().references(() => trustedDevices.id),
    sessionFingerprintHash: varchar("sessionFingerprintHash", { length: 64 }).notNull(),
    label: varchar("label", { length: 100 }).notNull(),
    authStrength: varchar("authStrength", { length: 32 }).default("basic").notNull(),
    lastSeenAt: timestamp("lastSeenAt").defaultNow().notNull(),
    revokedAt: timestamp("revokedAt"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  (table) => [
    uniqueIndex("security_session_user_fingerprint_unique").on(table.userId, table.sessionFingerprintHash),
    index("security_session_user_idx").on(table.userId, table.lastSeenAt),
  ],
);

/** One-time challenges are short-lived, attempt-limited, and consumed before a transfer is accepted. */
export const otpChallenges = mysqlTable(
  "otp_challenges",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    userId: int("userId").notNull().references(() => users.id),
    sessionId: varchar("sessionId", { length: 36 }).notNull().references(() => securitySessions.id),
    purpose: mysqlEnum("otp_purpose", ["transfer", "device_enrollment"]).notNull(),
    codeHash: varchar("codeHash", { length: 255 }).notNull(),
    status: mysqlEnum("otp_challenge_status", ["issued", "verified", "consumed", "expired", "locked"]).default("issued").notNull(),
    attempts: int("attempts").default(0).notNull(),
    expiresAt: timestamp("expiresAt").notNull(),
    verifiedAt: timestamp("verifiedAt"),
    consumedAt: timestamp("consumedAt"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  (table) => [index("otp_challenge_user_idx").on(table.userId, table.createdAt), index("otp_challenge_session_idx").on(table.sessionId, table.status)],
);

/** A linked provider account. Only a non-sensitive token reference is retained. */
export const bankAccounts = mysqlTable(
  "bank_accounts",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    userId: int("userId").notNull().references(() => users.id),
    provider: varchar("provider", { length: 64 }).notNull(),
    externalAccountId: varchar("externalAccountId", { length: 128 }).notNull(),
    displayName: varchar("displayName", { length: 120 }).notNull(),
    lastFour: varchar("lastFour", { length: 4 }).notNull(),
    status: mysqlEnum("bank_account_status", ["linked", "suspended", "unlinked"]).default("linked").notNull(),
    tokenReference: varchar("tokenReference", { length: 160 }).notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  (table) => [
    uniqueIndex("bank_account_provider_external_unique").on(table.provider, table.externalAccountId),
    index("bank_account_user_idx").on(table.userId),
  ],
);

/** An accounting account. Balances must be derived from ledger entries, never mutated here. */
export const financialAccounts = mysqlTable(
  "financial_accounts",
  {
    id: varchar("id", { length: 64 }).primaryKey(),
    userId: int("userId").references(() => users.id),
    bankAccountId: varchar("bankAccountId", { length: 36 }).references(() => bankAccounts.id),
    accountType: mysqlEnum("financial_account_type", ["user_wallet", "sandbox_clearing", "reserve"]).notNull(),
    currency: varchar("currency", { length: 3 }).default("HNL").notNull(),
    status: mysqlEnum("financial_account_status", ["active", "frozen", "closed"]).default("active").notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  (table) => [
    index("financial_account_user_idx").on(table.userId),
    index("financial_account_bank_idx").on(table.bankAccountId),
  ],
);

/** State changes are constrained in the application layer and every transfer has one unique reference. */
export const transfers = mysqlTable(
  "transfers",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    reference: varchar("reference", { length: 48 }).notNull(),
    senderUserId: int("senderUserId").notNull().references(() => users.id),
    recipientUserId: int("recipientUserId").references(() => users.id),
    recipientHandle: varchar("recipientHandle", { length: 80 }).notNull(),
    sourceAccountId: varchar("sourceAccountId", { length: 64 }).notNull().references(() => financialAccounts.id),
    destinationAccountId: varchar("destinationAccountId", { length: 64 }).notNull().references(() => financialAccounts.id),
    amountMinor: bigint("amountMinor", { mode: "number" }).notNull(),
    currency: varchar("currency", { length: 3 }).default("HNL").notNull(),
    status: mysqlEnum("transfer_status", ["created", "authenticating", "risk_review", "authorized", "processing", "settled", "declined", "failed", "canceled", "reversed", "expired"]).notNull(),
    riskDecision: mysqlEnum("risk_decision", ["allow", "challenge", "review", "block"]).notNull(),
    idempotencyKey: varchar("idempotencyKey", { length: 128 }).notNull(),
    requestFingerprint: varchar("requestFingerprint", { length: 64 }).notNull(),
    providerReference: varchar("providerReference", { length: 96 }),
    failureCode: varchar("failureCode", { length: 80 }),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    authorizedAt: timestamp("authorizedAt"),
    settledAt: timestamp("settledAt"),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  (table) => [
    uniqueIndex("transfer_reference_unique").on(table.reference),
    uniqueIndex("transfer_sender_idempotency_unique").on(table.senderUserId, table.idempotencyKey),
    index("transfer_sender_created_idx").on(table.senderUserId, table.createdAt),
    index("transfer_recipient_created_idx").on(table.recipientUserId, table.createdAt),
    index("transfer_status_idx").on(table.status),
  ],
);

/** Immutable debit/credit records. A transfer is settled only after both entries are posted. */
export const ledgerEntries = mysqlTable(
  "ledger_entries",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    transferId: varchar("transferId", { length: 36 }).notNull().references(() => transfers.id),
    accountId: varchar("accountId", { length: 64 }).notNull().references(() => financialAccounts.id),
    direction: mysqlEnum("ledger_direction", ["debit", "credit"]).notNull(),
    amountMinor: bigint("amountMinor", { mode: "number" }).notNull(),
    currency: varchar("currency", { length: 3 }).default("HNL").notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("ledger_transfer_account_direction_unique").on(table.transferId, table.accountId, table.direction),
    index("ledger_account_created_idx").on(table.accountId, table.createdAt),
    index("ledger_transfer_idx").on(table.transferId),
  ],
);

/** A payment request is a financial intent. Its fulfilment must be linked to a later transfer. */
export const paymentRequests = mysqlTable(
  "payment_requests",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    requesterUserId: int("requesterUserId").notNull().references(() => users.id),
    recipientHandle: varchar("recipientHandle", { length: 80 }).notNull(),
    amountMinor: bigint("amountMinor", { mode: "number" }).notNull(),
    currency: varchar("currency", { length: 3 }).default("HNL").notNull(),
    note: varchar("note", { length: 140 }),
    status: mysqlEnum("payment_request_status", ["open", "paid", "declined", "canceled", "expired"]).default("open").notNull(),
    idempotencyKey: varchar("idempotencyKey", { length: 128 }).notNull(),
    requestFingerprint: varchar("requestFingerprint", { length: 64 }).notNull(),
    transferId: varchar("transferId", { length: 36 }).references(() => transfers.id),
    canceledByUserId: int("canceledByUserId").references(() => users.id),
    canceledAt: timestamp("canceledAt"),
    expiresAt: timestamp("expiresAt").notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  (table) => [
    uniqueIndex("payment_request_requester_idempotency_unique").on(table.requesterUserId, table.idempotencyKey),
    uniqueIndex("payment_request_transfer_unique").on(table.transferId),
    index("payment_request_requester_idx").on(table.requesterUserId, table.createdAt),
    index("payment_request_status_idx").on(table.status),
  ],
);

/** Explainable risk decisions captured per transfer. */
export const riskEvents = mysqlTable(
  "risk_events",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    userId: int("userId").notNull().references(() => users.id),
    transferId: varchar("transferId", { length: 36 }).notNull().references(() => transfers.id),
    rule: varchar("rule", { length: 120 }).notNull(),
    score: int("score").notNull(),
    severity: mysqlEnum("risk_severity", ["low", "medium", "high"]).notNull(),
    decision: mysqlEnum("risk_event_decision", ["allow", "challenge", "review", "block"]).notNull(),
    policyVersion: varchar("policyVersion", { length: 40 }).notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  (table) => [index("risk_transfer_idx").on(table.transferId), index("risk_user_created_idx").on(table.userId, table.createdAt)],
);

/** Append-only actor trace. Store a hash or safe summary only; never credentials, PINs, OTPs, or raw tokens. */
export const auditEvents = mysqlTable(
  "audit_events",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    actorUserId: int("actorUserId").references(() => users.id),
    actorType: mysqlEnum("audit_actor_type", ["user", "admin", "system", "provider"]).notNull(),
    action: varchar("action", { length: 120 }).notNull(),
    resource: varchar("resource", { length: 80 }).notNull(),
    resourceId: varchar("resourceId", { length: 80 }).notNull(),
    requestId: varchar("requestId", { length: 64 }).notNull(),
    metadataHash: varchar("metadataHash", { length: 64 }).notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  (table) => [index("audit_resource_idx").on(table.resource, table.resourceId), index("audit_actor_created_idx").on(table.actorUserId, table.createdAt)],
);

/** Reconciliation records are investigated, never silently repaired. */
export const reconciliationItems = mysqlTable(
  "reconciliation_items",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    transferId: varchar("transferId", { length: 36 }).notNull().references(() => transfers.id),
    provider: varchar("provider", { length: 64 }).notNull(),
    providerReference: varchar("providerReference", { length: 96 }).notNull(),
    expectedAmountMinor: bigint("expectedAmountMinor", { mode: "number" }).notNull(),
    reportedAmountMinor: bigint("reportedAmountMinor", { mode: "number" }),
    status: mysqlEnum("reconciliation_status", ["match", "status_mismatch", "amount_mismatch", "missing_internal", "missing_external", "duplicate_external", "unknown"]).notNull(),
    investigatedAt: timestamp("investigatedAt"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  (table) => [uniqueIndex("reconciliation_transfer_unique").on(table.transferId), index("reconciliation_status_idx").on(table.status)],
);

/** Signed provider callbacks are retained before any financial state change is attempted. */
export const providerWebhookEvents = mysqlTable(
  "provider_webhook_events",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    provider: varchar("provider", { length: 64 }).notNull(),
    providerEventId: varchar("providerEventId", { length: 96 }).notNull(),
    eventType: varchar("eventType", { length: 80 }).notNull(),
    transferReference: varchar("transferReference", { length: 48 }).notNull(),
    providerReference: varchar("providerReference", { length: 96 }).notNull(),
    sequence: int("sequence").notNull(),
    occurredAt: timestamp("occurredAt").notNull(),
    payloadHash: varchar("payloadHash", { length: 64 }).notNull(),
    status: mysqlEnum("provider_webhook_status", ["accepted", "duplicate", "rejected", "ignored"]).notNull(),
    reason: varchar("reason", { length: 160 }),
    receivedAt: timestamp("receivedAt").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("provider_webhook_event_unique").on(table.provider, table.providerEventId),
    index("provider_webhook_transfer_idx").on(table.transferReference, table.receivedAt),
  ],
);

/** Transactional outbox records make provider intent and later recovery inspectable. */
export const outboxEvents = mysqlTable(
  "outbox_events",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    aggregateType: varchar("aggregateType", { length: 48 }).notNull(),
    aggregateId: varchar("aggregateId", { length: 64 }).notNull(),
    eventType: varchar("eventType", { length: 80 }).notNull(),
    payloadHash: varchar("payloadHash", { length: 64 }).notNull(),
    status: mysqlEnum("outbox_status", ["pending", "dispatched", "failed"]).default("pending").notNull(),
    attemptCount: int("attemptCount").default(0).notNull(),
    availableAt: timestamp("availableAt").defaultNow().notNull(),
    dispatchedAt: timestamp("dispatchedAt"),
    failureCode: varchar("failureCode", { length: 80 }),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  (table) => [
    index("outbox_pending_idx").on(table.status, table.availableAt),
    index("outbox_aggregate_idx").on(table.aggregateType, table.aggregateId),
  ],
);

/** Controlled operational switches. These must preserve investigation and reconciliation capabilities. */
export const operationalControls = mysqlTable("operational_controls", {
  control: varchar("control", { length: 64 }).primaryKey(),
  enabled: int("enabled").default(1).notNull(),
  reason: varchar("reason", { length: 180 }).notNull(),
  changedByUserId: int("changedByUserId").references(() => users.id),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;
export type Transfer = typeof transfers.$inferSelect;
export type LedgerEntry = typeof ledgerEntries.$inferSelect;
