-- Lira P2P Honduras — hardened PostgreSQL baseline
-- Sandbox only. Real-money activation is a separate gated decision.

CREATE TYPE user_role AS ENUM ('user','admin');
CREATE TYPE device_trust_status AS ENUM ('new','pending','trusted','restricted','revoked');
CREATE TYPE otp_purpose AS ENUM ('transfer','device_enrollment');
CREATE TYPE otp_challenge_status AS ENUM ('issued','verified','consumed','expired','locked');
CREATE TYPE bank_account_status AS ENUM ('linked','suspended','unlinked');
CREATE TYPE financial_account_type AS ENUM ('user_wallet','sandbox_clearing','reserve','provider_clearing','fees');
CREATE TYPE financial_account_status AS ENUM ('active','frozen','closed');
CREATE TYPE transfer_status AS ENUM ('created','authenticating','risk_review','authorized','processing','unknown','settled','declined','failed','canceled','reversed','expired');
CREATE TYPE risk_decision AS ENUM ('allow','challenge','review','block');
CREATE TYPE journal_type AS ENUM ('sandbox_seed','transfer_settlement','reversal','adjustment');
CREATE TYPE journal_status AS ENUM ('posted');
CREATE TYPE ledger_direction AS ENUM ('debit','credit');
CREATE TYPE hold_status AS ENUM ('active','captured','released','expired');
CREATE TYPE payment_request_status AS ENUM ('open','paid','declined','canceled','expired');
CREATE TYPE risk_severity AS ENUM ('low','medium','high');
CREATE TYPE audit_actor_type AS ENUM ('user','admin','system','provider');
CREATE TYPE reconciliation_status AS ENUM ('match','status_mismatch','amount_mismatch','missing_internal','missing_external','duplicate_external','unknown');
CREATE TYPE provider_webhook_status AS ENUM ('accepted','duplicate','rejected','ignored');
CREATE TYPE outbox_status AS ENUM ('pending','dispatching','dispatched','unknown','failed');

CREATE TABLE users (
  id serial PRIMARY KEY,
  "openId" varchar(64) NOT NULL UNIQUE,
  name text,
  email varchar(320),
  "loginMethod" varchar(64),
  role user_role NOT NULL DEFAULT 'user',
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now(),
  "lastSignedIn" timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE user_security_profiles (
  "userId" integer PRIMARY KEY REFERENCES users(id),
  "pinHash" varchar(255),
  "failedPinAttempts" integer NOT NULL DEFAULT 0 CHECK ("failedPinAttempts" >= 0),
  "lockedUntil" timestamptz,
  "pinUpdatedAt" timestamptz,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE daily_transfer_controls (
  id varchar(36) PRIMARY KEY,
  "userId" integer NOT NULL REFERENCES users(id),
  "periodStart" timestamptz NOT NULL,
  "attemptedMinor" bigint NOT NULL DEFAULT 0 CHECK ("attemptedMinor" >= 0),
  "attemptCount" integer NOT NULL DEFAULT 0 CHECK ("attemptCount" >= 0),
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now(),
  UNIQUE ("userId", "periodStart")
);
CREATE INDEX daily_transfer_control_user_idx ON daily_transfer_controls("userId", "periodStart");

CREATE TABLE trusted_devices (
  id varchar(36) PRIMARY KEY,
  "userId" integer NOT NULL REFERENCES users(id),
  "fingerprintHash" varchar(64) NOT NULL,
  label varchar(100) NOT NULL,
  platform varchar(80) NOT NULL,
  status device_trust_status NOT NULL DEFAULT 'new',
  "enrollmentRequestedAt" timestamptz NOT NULL DEFAULT now(),
  "eligibleAt" timestamptz,
  "trustedAt" timestamptz,
  "trustMethod" varchar(80),
  "lastUsedAt" timestamptz NOT NULL DEFAULT now(),
  "revokedAt" timestamptz,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now(),
  UNIQUE ("userId", "fingerprintHash")
);
CREATE INDEX trusted_device_user_idx ON trusted_devices("userId", "lastUsedAt");
CREATE INDEX trusted_device_status_idx ON trusted_devices("userId", status);

CREATE TABLE security_sessions (
  id varchar(36) PRIMARY KEY,
  "userId" integer NOT NULL REFERENCES users(id),
  "deviceId" varchar(36) NOT NULL REFERENCES trusted_devices(id),
  "sessionFingerprintHash" varchar(64) NOT NULL,
  label varchar(100) NOT NULL,
  "authStrength" varchar(32) NOT NULL DEFAULT 'basic',
  "lastSeenAt" timestamptz NOT NULL DEFAULT now(),
  "revokedAt" timestamptz,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now(),
  UNIQUE ("userId", "sessionFingerprintHash")
);
CREATE INDEX security_session_user_idx ON security_sessions("userId", "lastSeenAt");

CREATE TABLE otp_challenges (
  id varchar(36) PRIMARY KEY,
  "userId" integer NOT NULL REFERENCES users(id),
  "sessionId" varchar(36) NOT NULL REFERENCES security_sessions(id),
  purpose otp_purpose NOT NULL,
  "codeHash" varchar(255) NOT NULL,
  status otp_challenge_status NOT NULL DEFAULT 'issued',
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  "expiresAt" timestamptz NOT NULL,
  "verifiedAt" timestamptz,
  "consumedAt" timestamptz,
  "createdAt" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX otp_challenge_user_idx ON otp_challenges("userId", "createdAt");
CREATE INDEX otp_challenge_session_idx ON otp_challenges("sessionId", status);

CREATE TABLE bank_accounts (
  id varchar(36) PRIMARY KEY,
  "userId" integer NOT NULL REFERENCES users(id),
  provider varchar(64) NOT NULL,
  "externalAccountId" varchar(128) NOT NULL,
  "displayName" varchar(120) NOT NULL,
  "lastFour" varchar(4) NOT NULL CHECK ("lastFour" ~ '^[0-9]{4}$'),
  status bank_account_status NOT NULL DEFAULT 'linked',
  "tokenReference" varchar(160) NOT NULL,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now(),
  UNIQUE(provider, "externalAccountId")
);
CREATE INDEX bank_account_user_idx ON bank_accounts("userId");

CREATE TABLE financial_accounts (
  id varchar(64) PRIMARY KEY,
  "userId" integer REFERENCES users(id),
  "bankAccountId" varchar(36) REFERENCES bank_accounts(id),
  "accountType" financial_account_type NOT NULL,
  currency varchar(3) NOT NULL DEFAULT 'HNL' CHECK (currency = 'HNL'),
  status financial_account_status NOT NULL DEFAULT 'active',
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX financial_account_user_idx ON financial_accounts("userId");
CREATE INDEX financial_account_bank_idx ON financial_accounts("bankAccountId");

CREATE TABLE transfers (
  id varchar(36) PRIMARY KEY,
  reference varchar(48) NOT NULL UNIQUE,
  "senderUserId" integer NOT NULL REFERENCES users(id),
  "recipientUserId" integer REFERENCES users(id),
  "recipientHandle" varchar(80) NOT NULL,
  "sourceAccountId" varchar(64) NOT NULL REFERENCES financial_accounts(id),
  "destinationAccountId" varchar(64) NOT NULL REFERENCES financial_accounts(id),
  "amountMinor" bigint NOT NULL CHECK ("amountMinor" > 0),
  currency varchar(3) NOT NULL DEFAULT 'HNL' CHECK (currency = 'HNL'),
  status transfer_status NOT NULL,
  "riskDecision" risk_decision NOT NULL,
  "idempotencyKey" varchar(128) NOT NULL,
  "requestFingerprint" varchar(64) NOT NULL,
  "providerReference" varchar(96),
  "failureCode" varchar(80),
  "unknownReason" varchar(160),
  "settlementJournalId" varchar(36),
  "reversalJournalId" varchar(36),
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "authorizedAt" timestamptz,
  "providerSubmittedAt" timestamptz,
  "providerAcceptedAt" timestamptz,
  "unknownAt" timestamptz,
  "settledAt" timestamptz,
  "reversedAt" timestamptz,
  "updatedAt" timestamptz NOT NULL DEFAULT now(),
  UNIQUE ("senderUserId", "idempotencyKey"),
  CHECK ("sourceAccountId" <> "destinationAccountId")
);
CREATE INDEX transfer_sender_created_idx ON transfers("senderUserId", "createdAt");
CREATE INDEX transfer_recipient_created_idx ON transfers("recipientUserId", "createdAt");
CREATE INDEX transfer_status_idx ON transfers(status);
CREATE INDEX transfer_provider_ref_idx ON transfers("providerReference");

CREATE TABLE fund_reservations (
  id varchar(36) PRIMARY KEY,
  "transferId" varchar(36) NOT NULL UNIQUE REFERENCES transfers(id),
  "accountId" varchar(64) NOT NULL REFERENCES financial_accounts(id),
  "amountMinor" bigint NOT NULL CHECK ("amountMinor" > 0),
  currency varchar(3) NOT NULL DEFAULT 'HNL' CHECK (currency = 'HNL'),
  status hold_status NOT NULL DEFAULT 'active',
  "expiresAt" timestamptz,
  "capturedAt" timestamptz,
  "releasedAt" timestamptz,
  "releaseReason" varchar(120),
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX fund_reservation_account_status_idx ON fund_reservations("accountId", status);

CREATE TABLE journal_transactions (
  id varchar(36) PRIMARY KEY,
  reference varchar(64) NOT NULL UNIQUE,
  "transferId" varchar(36) REFERENCES transfers(id),
  type journal_type NOT NULL,
  status journal_status NOT NULL DEFAULT 'posted',
  currency varchar(3) NOT NULL DEFAULT 'HNL' CHECK (currency = 'HNL'),
  "reversesJournalId" varchar(36) REFERENCES journal_transactions(id),
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "postedAt" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX journal_transfer_idx ON journal_transactions("transferId");
CREATE INDEX journal_reversal_idx ON journal_transactions("reversesJournalId");

CREATE TABLE ledger_entries (
  id varchar(36) PRIMARY KEY,
  "journalId" varchar(36) NOT NULL REFERENCES journal_transactions(id),
  "transferId" varchar(36) REFERENCES transfers(id),
  "accountId" varchar(64) NOT NULL REFERENCES financial_accounts(id),
  direction ledger_direction NOT NULL,
  "amountMinor" bigint NOT NULL CHECK ("amountMinor" > 0),
  currency varchar(3) NOT NULL DEFAULT 'HNL' CHECK (currency = 'HNL'),
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  UNIQUE ("journalId", "accountId", direction)
);
CREATE INDEX ledger_account_created_idx ON ledger_entries("accountId", "createdAt");
CREATE INDEX ledger_transfer_idx ON ledger_entries("transferId");
CREATE INDEX ledger_journal_idx ON ledger_entries("journalId");

CREATE TABLE payment_requests (
  id varchar(36) PRIMARY KEY,
  "requesterUserId" integer NOT NULL REFERENCES users(id),
  "recipientHandle" varchar(80) NOT NULL,
  "amountMinor" bigint NOT NULL CHECK ("amountMinor" > 0),
  currency varchar(3) NOT NULL DEFAULT 'HNL' CHECK (currency = 'HNL'),
  note varchar(140),
  status payment_request_status NOT NULL DEFAULT 'open',
  "idempotencyKey" varchar(128) NOT NULL,
  "requestFingerprint" varchar(64) NOT NULL,
  "transferId" varchar(36) UNIQUE REFERENCES transfers(id),
  "canceledByUserId" integer REFERENCES users(id),
  "canceledAt" timestamptz,
  "expiresAt" timestamptz NOT NULL,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now(),
  UNIQUE ("requesterUserId", "idempotencyKey")
);
CREATE INDEX payment_request_requester_idx ON payment_requests("requesterUserId", "createdAt");
CREATE INDEX payment_request_status_idx ON payment_requests(status);

CREATE TABLE risk_events (
  id varchar(36) PRIMARY KEY,
  "userId" integer NOT NULL REFERENCES users(id),
  "transferId" varchar(36) NOT NULL REFERENCES transfers(id),
  rule varchar(120) NOT NULL,
  score integer NOT NULL CHECK (score >= 0),
  severity risk_severity NOT NULL,
  decision risk_decision NOT NULL,
  "policyVersion" varchar(40) NOT NULL,
  "createdAt" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX risk_transfer_idx ON risk_events("transferId");
CREATE INDEX risk_user_created_idx ON risk_events("userId", "createdAt");

CREATE TABLE audit_events (
  id varchar(36) PRIMARY KEY,
  "actorUserId" integer REFERENCES users(id),
  "actorType" audit_actor_type NOT NULL,
  action varchar(120) NOT NULL,
  resource varchar(80) NOT NULL,
  "resourceId" varchar(80) NOT NULL,
  "requestId" varchar(128) NOT NULL,
  "metadataHash" varchar(64) NOT NULL,
  "createdAt" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_resource_idx ON audit_events(resource, "resourceId");
CREATE INDEX audit_actor_created_idx ON audit_events("actorUserId", "createdAt");

CREATE TABLE reconciliation_items (
  id varchar(36) PRIMARY KEY,
  "transferId" varchar(36) NOT NULL UNIQUE REFERENCES transfers(id),
  provider varchar(64) NOT NULL,
  "providerReference" varchar(96) NOT NULL,
  "expectedAmountMinor" bigint NOT NULL CHECK ("expectedAmountMinor" > 0),
  "reportedAmountMinor" bigint CHECK ("reportedAmountMinor" IS NULL OR "reportedAmountMinor" > 0),
  status reconciliation_status NOT NULL,
  "investigatedAt" timestamptz,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX reconciliation_status_idx ON reconciliation_items(status);

CREATE TABLE provider_webhook_events (
  id varchar(36) PRIMARY KEY,
  provider varchar(64) NOT NULL,
  "providerEventId" varchar(96) NOT NULL,
  "eventType" varchar(80) NOT NULL,
  "transferReference" varchar(48) NOT NULL,
  "providerReference" varchar(96) NOT NULL,
  sequence integer NOT NULL CHECK (sequence >= 0),
  "occurredAt" timestamptz NOT NULL,
  "payloadHash" varchar(64) NOT NULL,
  status provider_webhook_status NOT NULL,
  reason varchar(160),
  "receivedAt" timestamptz NOT NULL DEFAULT now(),
  UNIQUE(provider, "providerEventId")
);
CREATE INDEX provider_webhook_transfer_idx ON provider_webhook_events("transferReference", "receivedAt");

CREATE TABLE outbox_events (
  id varchar(36) PRIMARY KEY,
  "aggregateType" varchar(48) NOT NULL,
  "aggregateId" varchar(64) NOT NULL,
  "eventType" varchar(80) NOT NULL,
  "payloadHash" varchar(64) NOT NULL,
  status outbox_status NOT NULL DEFAULT 'pending',
  "attemptCount" integer NOT NULL DEFAULT 0 CHECK ("attemptCount" >= 0),
  "availableAt" timestamptz NOT NULL DEFAULT now(),
  "claimedAt" timestamptz,
  "dispatchedAt" timestamptz,
  "failureCode" varchar(80),
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX outbox_pending_idx ON outbox_events(status, "availableAt");
CREATE INDEX outbox_aggregate_idx ON outbox_events("aggregateType", "aggregateId");

CREATE TABLE operational_controls (
  control varchar(64) PRIMARY KEY,
  enabled boolean NOT NULL DEFAULT true,
  reason varchar(180) NOT NULL,
  "changedByUserId" integer REFERENCES users(id),
  "updatedAt" timestamptz NOT NULL DEFAULT now()
);

-- Fail closed at first boot. An authorized admin must explicitly enable sandbox transfers.
INSERT INTO operational_controls(control, enabled, reason)
VALUES ('transfers_enabled', false, 'Default deny until sandbox validation gate is explicitly approved');

-- Ledger rows are append-only. Corrections are new compensating journals.
CREATE OR REPLACE FUNCTION lira_block_ledger_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'ledger entries are immutable; post a compensating journal instead';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER ledger_entries_immutable
BEFORE UPDATE OR DELETE ON ledger_entries
FOR EACH ROW EXECUTE FUNCTION lira_block_ledger_mutation();

CREATE OR REPLACE FUNCTION lira_block_posted_journal_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'posted journals are immutable';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER posted_journals_immutable
BEFORE UPDATE OR DELETE ON journal_transactions
FOR EACH ROW WHEN (OLD.status = 'posted') EXECUTE FUNCTION lira_block_posted_journal_mutation();

-- Deferred invariant: every journal touched by ledger writes must end the transaction balanced.
CREATE OR REPLACE FUNCTION lira_assert_balanced_journal() RETURNS trigger AS $$
DECLARE
  target_journal varchar(36);
  entry_count integer;
  debit_total numeric;
  credit_total numeric;
  currency_count integer;
BEGIN
  target_journal := COALESCE(NEW."journalId", OLD."journalId");
  SELECT count(*),
         coalesce(sum(CASE WHEN direction='debit' THEN "amountMinor" ELSE 0 END),0),
         coalesce(sum(CASE WHEN direction='credit' THEN "amountMinor" ELSE 0 END),0),
         count(DISTINCT currency)
    INTO entry_count, debit_total, credit_total, currency_count
    FROM ledger_entries WHERE "journalId"=target_journal;
  IF entry_count < 2 OR debit_total <> credit_total OR currency_count <> 1 THEN
    RAISE EXCEPTION 'unbalanced journal %: count %, debit %, credit %, currencies %', target_journal, entry_count, debit_total, credit_total, currency_count;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;
CREATE CONSTRAINT TRIGGER ledger_journal_balance_check
AFTER INSERT ON ledger_entries
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION lira_assert_balanced_journal();
