import {
  bigint,
  boolean,
  index,
  integer,
  pgEnum,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from "drizzle-orm/pg-core";

const ts = (name: string) => timestamp(name, { withTimezone: true });

export const userRole = pgEnum("user_role", ["user", "admin"]);
export const deviceTrustStatus = pgEnum("device_trust_status", ["new", "pending", "trusted", "restricted", "revoked"]);
export const otpPurpose = pgEnum("otp_purpose", ["transfer", "device_enrollment"]);
export const otpChallengeStatus = pgEnum("otp_challenge_status", ["issued", "verified", "consumed", "expired", "locked"]);
export const bankAccountStatus = pgEnum("bank_account_status", ["linked", "suspended", "unlinked"]);
export const financialAccountType = pgEnum("financial_account_type", ["user_wallet", "sandbox_clearing", "reserve", "provider_clearing", "fees"]);
export const financialAccountStatus = pgEnum("financial_account_status", ["active", "frozen", "closed"]);
export const transferStatus = pgEnum("transfer_status", [
  "created",
  "authenticating",
  "risk_review",
  "authorized",
  "processing",
  "unknown",
  "settled",
  "declined",
  "failed",
  "canceled",
  "reversed",
  "expired",
]);
export const riskDecision = pgEnum("risk_decision", ["allow", "challenge", "review", "block"]);
export const journalType = pgEnum("journal_type", ["sandbox_seed", "transfer_settlement", "reversal", "adjustment"]);
export const journalStatus = pgEnum("journal_status", ["posted"]);
export const ledgerDirection = pgEnum("ledger_direction", ["debit", "credit"]);
export const holdStatus = pgEnum("hold_status", ["active", "captured", "released", "expired"]);
export const paymentRequestStatus = pgEnum("payment_request_status", ["open", "paid", "declined", "canceled", "expired"]);
export const riskSeverity = pgEnum("risk_severity", ["low", "medium", "high"]);
export const auditActorType = pgEnum("audit_actor_type", ["user", "admin", "system", "provider"]);
export const reconciliationStatus = pgEnum("reconciliation_status", ["match", "status_mismatch", "amount_mismatch", "missing_internal", "missing_external", "duplicate_external", "unknown"]);
export const providerWebhookStatus = pgEnum("provider_webhook_status", ["accepted", "duplicate", "rejected", "ignored"]);
export const outboxStatus = pgEnum("outbox_status", ["pending", "dispatching", "dispatched", "unknown", "failed", "dead_letter"]);

/** Core identity record. */
export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: userRole("role").default("user").notNull(),
  createdAt: ts("createdAt").defaultNow().notNull(),
  updatedAt: ts("updatedAt").defaultNow().notNull(),
  lastSignedIn: ts("lastSignedIn").defaultNow().notNull(),
});

export const userSecurityProfiles = pgTable("user_security_profiles", {
  userId: integer("userId").primaryKey().references(() => users.id),
  pinHash: varchar("pinHash", { length: 255 }),
  failedPinAttempts: integer("failedPinAttempts").default(0).notNull(),
  lockedUntil: ts("lockedUntil"),
  pinUpdatedAt: ts("pinUpdatedAt"),
  createdAt: ts("createdAt").defaultNow().notNull(),
  updatedAt: ts("updatedAt").defaultNow().notNull(),
});

export const dailyTransferControls = pgTable(
  "daily_transfer_controls",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    userId: integer("userId").notNull().references(() => users.id),
    periodStart: ts("periodStart").notNull(),
    attemptedMinor: bigint("attemptedMinor", { mode: "number" }).default(0).notNull(),
    attemptCount: integer("attemptCount").default(0).notNull(),
    createdAt: ts("createdAt").defaultNow().notNull(),
    updatedAt: ts("updatedAt").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("daily_transfer_control_user_period_unique").on(table.userId, table.periodStart),
    index("daily_transfer_control_user_idx").on(table.userId, table.periodStart),
  ],
);

/** Browser/device fingerprints are discovery signals, never automatic trust. */
export const trustedDevices = pgTable(
  "trusted_devices",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    userId: integer("userId").notNull().references(() => users.id),
    fingerprintHash: varchar("fingerprintHash", { length: 64 }).notNull(),
    label: varchar("label", { length: 100 }).notNull(),
    platform: varchar("platform", { length: 80 }).notNull(),
    status: deviceTrustStatus("status").default("new").notNull(),
    enrollmentRequestedAt: ts("enrollmentRequestedAt").defaultNow().notNull(),
    eligibleAt: ts("eligibleAt"),
    trustedAt: ts("trustedAt"),
    trustMethod: varchar("trustMethod", { length: 80 }),
    lastUsedAt: ts("lastUsedAt").defaultNow().notNull(),
    revokedAt: ts("revokedAt"),
    createdAt: ts("createdAt").defaultNow().notNull(),
    updatedAt: ts("updatedAt").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("trusted_device_user_fingerprint_unique").on(table.userId, table.fingerprintHash),
    index("trusted_device_user_idx").on(table.userId, table.lastUsedAt),
    index("trusted_device_status_idx").on(table.userId, table.status),
  ],
);

export const securitySessions = pgTable(
  "security_sessions",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    userId: integer("userId").notNull().references(() => users.id),
    deviceId: varchar("deviceId", { length: 36 }).notNull().references(() => trustedDevices.id),
    sessionFingerprintHash: varchar("sessionFingerprintHash", { length: 64 }).notNull(),
    label: varchar("label", { length: 100 }).notNull(),
    authStrength: varchar("authStrength", { length: 32 }).default("basic").notNull(),
    lastSeenAt: ts("lastSeenAt").defaultNow().notNull(),
    revokedAt: ts("revokedAt"),
    createdAt: ts("createdAt").defaultNow().notNull(),
    updatedAt: ts("updatedAt").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("security_session_user_fingerprint_unique").on(table.userId, table.sessionFingerprintHash),
    index("security_session_user_idx").on(table.userId, table.lastSeenAt),
  ],
);

export const otpChallenges = pgTable(
  "otp_challenges",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    userId: integer("userId").notNull().references(() => users.id),
    sessionId: varchar("sessionId", { length: 36 }).notNull().references(() => securitySessions.id),
    purpose: otpPurpose("purpose").notNull(),
    codeHash: varchar("codeHash", { length: 255 }).notNull(),
    status: otpChallengeStatus("status").default("issued").notNull(),
    attempts: integer("attempts").default(0).notNull(),
    expiresAt: ts("expiresAt").notNull(),
    verifiedAt: ts("verifiedAt"),
    consumedAt: ts("consumedAt"),
    createdAt: ts("createdAt").defaultNow().notNull(),
  },
  (table) => [
    index("otp_challenge_user_idx").on(table.userId, table.createdAt),
    index("otp_challenge_session_idx").on(table.sessionId, table.status),
  ],
);

export const bankAccounts = pgTable(
  "bank_accounts",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    userId: integer("userId").notNull().references(() => users.id),
    provider: varchar("provider", { length: 64 }).notNull(),
    externalAccountId: varchar("externalAccountId", { length: 128 }).notNull(),
    displayName: varchar("displayName", { length: 120 }).notNull(),
    lastFour: varchar("lastFour", { length: 4 }).notNull(),
    status: bankAccountStatus("status").default("linked").notNull(),
    tokenReference: varchar("tokenReference", { length: 160 }).notNull(),
    createdAt: ts("createdAt").defaultNow().notNull(),
    updatedAt: ts("updatedAt").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("bank_account_provider_external_unique").on(table.provider, table.externalAccountId),
    index("bank_account_user_idx").on(table.userId),
  ],
);

export const financialAccounts = pgTable(
  "financial_accounts",
  {
    id: varchar("id", { length: 64 }).primaryKey(),
    userId: integer("userId").references(() => users.id),
    bankAccountId: varchar("bankAccountId", { length: 36 }).references(() => bankAccounts.id),
    accountType: financialAccountType("accountType").notNull(),
    currency: varchar("currency", { length: 3 }).default("HNL").notNull(),
    status: financialAccountStatus("status").default("active").notNull(),
    createdAt: ts("createdAt").defaultNow().notNull(),
    updatedAt: ts("updatedAt").defaultNow().notNull(),
  },
  (table) => [index("financial_account_user_idx").on(table.userId), index("financial_account_bank_idx").on(table.bankAccountId)],
);

export const transfers = pgTable(
  "transfers",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    reference: varchar("reference", { length: 48 }).notNull(),
    senderUserId: integer("senderUserId").notNull().references(() => users.id),
    recipientUserId: integer("recipientUserId").references(() => users.id),
    recipientHandle: varchar("recipientHandle", { length: 80 }).notNull(),
    sourceAccountId: varchar("sourceAccountId", { length: 64 }).notNull().references(() => financialAccounts.id),
    destinationAccountId: varchar("destinationAccountId", { length: 64 }).notNull().references(() => financialAccounts.id),
    amountMinor: bigint("amountMinor", { mode: "number" }).notNull(),
    currency: varchar("currency", { length: 3 }).default("HNL").notNull(),
    status: transferStatus("status").notNull(),
    riskDecision: riskDecision("riskDecision").notNull(),
    idempotencyKey: varchar("idempotencyKey", { length: 128 }).notNull(),
    requestFingerprint: varchar("requestFingerprint", { length: 64 }).notNull(),
    providerReference: varchar("providerReference", { length: 96 }),
    failureCode: varchar("failureCode", { length: 80 }),
    unknownReason: varchar("unknownReason", { length: 160 }),
    settlementJournalId: varchar("settlementJournalId", { length: 36 }),
    reversalJournalId: varchar("reversalJournalId", { length: 36 }),
    createdAt: ts("createdAt").defaultNow().notNull(),
    authorizedAt: ts("authorizedAt"),
    providerSubmittedAt: ts("providerSubmittedAt"),
    providerAcceptedAt: ts("providerAcceptedAt"),
    unknownAt: ts("unknownAt"),
    settledAt: ts("settledAt"),
    reversedAt: ts("reversedAt"),
    updatedAt: ts("updatedAt").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("transfer_reference_unique").on(table.reference),
    uniqueIndex("transfer_sender_idempotency_unique").on(table.senderUserId, table.idempotencyKey),
    index("transfer_sender_created_idx").on(table.senderUserId, table.createdAt),
    index("transfer_recipient_created_idx").on(table.recipientUserId, table.createdAt),
    index("transfer_status_idx").on(table.status),
    index("transfer_provider_ref_idx").on(table.providerReference),
  ],
);

/** Reservations protect available funds before provider settlement. */
export const fundReservations = pgTable(
  "fund_reservations",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    transferId: varchar("transferId", { length: 36 }).notNull().references(() => transfers.id),
    accountId: varchar("accountId", { length: 64 }).notNull().references(() => financialAccounts.id),
    amountMinor: bigint("amountMinor", { mode: "number" }).notNull(),
    currency: varchar("currency", { length: 3 }).default("HNL").notNull(),
    status: holdStatus("status").default("active").notNull(),
    expiresAt: ts("expiresAt"),
    capturedAt: ts("capturedAt"),
    releasedAt: ts("releasedAt"),
    releaseReason: varchar("releaseReason", { length: 120 }),
    createdAt: ts("createdAt").defaultNow().notNull(),
    updatedAt: ts("updatedAt").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("fund_reservation_transfer_unique").on(table.transferId),
    index("fund_reservation_account_status_idx").on(table.accountId, table.status),
  ],
);

export const journalTransactions = pgTable(
  "journal_transactions",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    reference: varchar("reference", { length: 64 }).notNull(),
    transferId: varchar("transferId", { length: 36 }).references(() => transfers.id),
    type: journalType("type").notNull(),
    status: journalStatus("status").default("posted").notNull(),
    currency: varchar("currency", { length: 3 }).default("HNL").notNull(),
    reversesJournalId: varchar("reversesJournalId", { length: 36 }),
    createdAt: ts("createdAt").defaultNow().notNull(),
    postedAt: ts("postedAt").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("journal_reference_unique").on(table.reference),
    index("journal_transfer_idx").on(table.transferId),
    index("journal_reversal_idx").on(table.reversesJournalId),
  ],
);

export const ledgerEntries = pgTable(
  "ledger_entries",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    journalId: varchar("journalId", { length: 36 }).notNull().references(() => journalTransactions.id),
    transferId: varchar("transferId", { length: 36 }).references(() => transfers.id),
    accountId: varchar("accountId", { length: 64 }).notNull().references(() => financialAccounts.id),
    direction: ledgerDirection("direction").notNull(),
    amountMinor: bigint("amountMinor", { mode: "number" }).notNull(),
    currency: varchar("currency", { length: 3 }).default("HNL").notNull(),
    createdAt: ts("createdAt").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("ledger_journal_account_direction_unique").on(table.journalId, table.accountId, table.direction),
    index("ledger_account_created_idx").on(table.accountId, table.createdAt),
    index("ledger_transfer_idx").on(table.transferId),
    index("ledger_journal_idx").on(table.journalId),
  ],
);

export const paymentRequests = pgTable(
  "payment_requests",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    requesterUserId: integer("requesterUserId").notNull().references(() => users.id),
    recipientHandle: varchar("recipientHandle", { length: 80 }).notNull(),
    amountMinor: bigint("amountMinor", { mode: "number" }).notNull(),
    currency: varchar("currency", { length: 3 }).default("HNL").notNull(),
    note: varchar("note", { length: 140 }),
    status: paymentRequestStatus("status").default("open").notNull(),
    idempotencyKey: varchar("idempotencyKey", { length: 128 }).notNull(),
    requestFingerprint: varchar("requestFingerprint", { length: 64 }).notNull(),
    transferId: varchar("transferId", { length: 36 }).references(() => transfers.id),
    canceledByUserId: integer("canceledByUserId").references(() => users.id),
    canceledAt: ts("canceledAt"),
    expiresAt: ts("expiresAt").notNull(),
    createdAt: ts("createdAt").defaultNow().notNull(),
    updatedAt: ts("updatedAt").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("payment_request_requester_idempotency_unique").on(table.requesterUserId, table.idempotencyKey),
    uniqueIndex("payment_request_transfer_unique").on(table.transferId),
    index("payment_request_requester_idx").on(table.requesterUserId, table.createdAt),
    index("payment_request_status_idx").on(table.status),
  ],
);

export const riskEvents = pgTable(
  "risk_events",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    userId: integer("userId").notNull().references(() => users.id),
    transferId: varchar("transferId", { length: 36 }).notNull().references(() => transfers.id),
    rule: varchar("rule", { length: 120 }).notNull(),
    score: integer("score").notNull(),
    severity: riskSeverity("severity").notNull(),
    decision: riskDecision("decision").notNull(),
    policyVersion: varchar("policyVersion", { length: 40 }).notNull(),
    createdAt: ts("createdAt").defaultNow().notNull(),
  },
  (table) => [index("risk_transfer_idx").on(table.transferId), index("risk_user_created_idx").on(table.userId, table.createdAt)],
);

export const auditEvents = pgTable(
  "audit_events",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    actorUserId: integer("actorUserId").references(() => users.id),
    actorType: auditActorType("actorType").notNull(),
    action: varchar("action", { length: 120 }).notNull(),
    resource: varchar("resource", { length: 80 }).notNull(),
    resourceId: varchar("resourceId", { length: 80 }).notNull(),
    requestId: varchar("requestId", { length: 128 }).notNull(),
    metadataHash: varchar("metadataHash", { length: 64 }).notNull(),
    createdAt: ts("createdAt").defaultNow().notNull(),
  },
  (table) => [index("audit_resource_idx").on(table.resource, table.resourceId), index("audit_actor_created_idx").on(table.actorUserId, table.createdAt)],
);

export const reconciliationItems = pgTable(
  "reconciliation_items",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    transferId: varchar("transferId", { length: 36 }).notNull().references(() => transfers.id),
    provider: varchar("provider", { length: 64 }).notNull(),
    providerReference: varchar("providerReference", { length: 96 }).notNull(),
    expectedAmountMinor: bigint("expectedAmountMinor", { mode: "number" }).notNull(),
    reportedAmountMinor: bigint("reportedAmountMinor", { mode: "number" }),
    status: reconciliationStatus("status").notNull(),
    investigatedAt: ts("investigatedAt"),
    createdAt: ts("createdAt").defaultNow().notNull(),
    updatedAt: ts("updatedAt").defaultNow().notNull(),
  },
  (table) => [uniqueIndex("reconciliation_transfer_unique").on(table.transferId), index("reconciliation_status_idx").on(table.status)],
);

export const providerWebhookEvents = pgTable(
  "provider_webhook_events",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    provider: varchar("provider", { length: 64 }).notNull(),
    providerEventId: varchar("providerEventId", { length: 96 }).notNull(),
    eventType: varchar("eventType", { length: 80 }).notNull(),
    transferReference: varchar("transferReference", { length: 48 }).notNull(),
    providerReference: varchar("providerReference", { length: 96 }).notNull(),
    sequence: integer("sequence").notNull(),
    occurredAt: ts("occurredAt").notNull(),
    payloadHash: varchar("payloadHash", { length: 64 }).notNull(),
    status: providerWebhookStatus("status").notNull(),
    reason: varchar("reason", { length: 160 }),
    receivedAt: ts("receivedAt").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("provider_webhook_event_unique").on(table.provider, table.providerEventId),
    index("provider_webhook_transfer_idx").on(table.transferReference, table.receivedAt),
  ],
);

export const outboxEvents = pgTable(
  "outbox_events",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    aggregateType: varchar("aggregateType", { length: 48 }).notNull(),
    aggregateId: varchar("aggregateId", { length: 64 }).notNull(),
    eventType: varchar("eventType", { length: 80 }).notNull(),
    payloadHash: varchar("payloadHash", { length: 64 }).notNull(),
    status: outboxStatus("status").default("pending").notNull(),
    attemptCount: integer("attemptCount").default(0).notNull(),
    availableAt: ts("availableAt").defaultNow().notNull(),
    claimedAt: ts("claimedAt"),
    dispatchedAt: ts("dispatchedAt"),
    failureCode: varchar("failureCode", { length: 80 }),
    createdAt: ts("createdAt").defaultNow().notNull(),
    updatedAt: ts("updatedAt").defaultNow().notNull(),
  },
  (table) => [index("outbox_pending_idx").on(table.status, table.availableAt), index("outbox_aggregate_idx").on(table.aggregateType, table.aggregateId)],
);

export const operationalControls = pgTable("operational_controls", {
  control: varchar("control", { length: 64 }).primaryKey(),
  enabled: boolean("enabled").default(true).notNull(),
  reason: varchar("reason", { length: 180 }).notNull(),
  changedByUserId: integer("changedByUserId").references(() => users.id),
  updatedAt: ts("updatedAt").defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;
export type Transfer = typeof transfers.$inferSelect;
export type LedgerEntry = typeof ledgerEntries.$inferSelect;
