-- Personal-finance utilities are sandbox-only. They add no bank credential,
-- PAN, processor token, or direct editable balance.

ALTER TYPE otp_purpose ADD VALUE IF NOT EXISTS 'savings_contribution';
ALTER TYPE journal_type ADD VALUE IF NOT EXISTS 'savings_contribution';
ALTER TYPE journal_type ADD VALUE IF NOT EXISTS 'payroll_deposit';

CREATE TYPE savings_goal_status AS ENUM ('active', 'paused', 'archived');
CREATE TYPE sandbox_card_status AS ENUM ('active', 'frozen', 'closed');
CREATE TYPE sandbox_payroll_status AS ENUM ('active', 'paused');

CREATE TABLE savings_goals (
  id varchar(36) PRIMARY KEY,
  "userId" integer NOT NULL REFERENCES users(id),
  name varchar(80) NOT NULL,
  "targetMinor" bigint NOT NULL CHECK ("targetMinor" > 0),
  "reserveAccountId" varchar(64) NOT NULL UNIQUE REFERENCES financial_accounts(id),
  status savings_goal_status NOT NULL DEFAULT 'active',
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX savings_goal_user_status_idx ON savings_goals("userId", status);

CREATE TABLE savings_goal_contributions (
  id varchar(36) PRIMARY KEY,
  "goalId" varchar(36) NOT NULL REFERENCES savings_goals(id),
  "userId" integer NOT NULL REFERENCES users(id),
  "amountMinor" bigint NOT NULL CHECK ("amountMinor" > 0),
  "idempotencyKey" varchar(128) NOT NULL,
  "requestFingerprint" varchar(64) NOT NULL,
  "journalId" varchar(36) NOT NULL UNIQUE REFERENCES journal_transactions(id),
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  UNIQUE ("userId", "idempotencyKey")
);
CREATE INDEX savings_contribution_goal_idx ON savings_goal_contributions("goalId", "createdAt");

CREATE TABLE savings_goal_withdrawals (
  id varchar(36) PRIMARY KEY,
  "goalId" varchar(36) NOT NULL REFERENCES savings_goals(id),
  "userId" integer NOT NULL REFERENCES users(id),
  "amountMinor" bigint NOT NULL CHECK ("amountMinor" > 0),
  "idempotencyKey" varchar(128) NOT NULL,
  "requestFingerprint" varchar(64) NOT NULL,
  "journalId" varchar(36) NOT NULL UNIQUE REFERENCES journal_transactions(id),
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  UNIQUE ("userId", "idempotencyKey")
);
CREATE INDEX savings_withdrawal_goal_idx ON savings_goal_withdrawals("goalId", "createdAt");

CREATE TABLE sandbox_cards (
  id varchar(36) PRIMARY KEY,
  "userId" integer NOT NULL UNIQUE REFERENCES users(id),
  label varchar(80) NOT NULL,
  "lastFour" varchar(4) NOT NULL CHECK ("lastFour" ~ '^[0-9]{4}$'),
  status sandbox_card_status NOT NULL DEFAULT 'active',
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE sandbox_payroll_profiles (
  id varchar(36) PRIMARY KEY,
  "userId" integer NOT NULL UNIQUE REFERENCES users(id),
  "employerName" varchar(120) NOT NULL,
  "routingLabel" varchar(80) NOT NULL,
  status sandbox_payroll_status NOT NULL DEFAULT 'active',
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE sandbox_payroll_deposits (
  id varchar(36) PRIMARY KEY,
  "userId" integer NOT NULL REFERENCES users(id),
  "profileId" varchar(36) NOT NULL REFERENCES sandbox_payroll_profiles(id),
  "amountMinor" bigint NOT NULL CHECK ("amountMinor" > 0),
  "idempotencyKey" varchar(128) NOT NULL UNIQUE,
  "requestFingerprint" varchar(64) NOT NULL,
  "journalId" varchar(36) NOT NULL UNIQUE REFERENCES journal_transactions(id),
  "createdByUserId" integer NOT NULL REFERENCES users(id),
  "createdAt" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sandbox_payroll_deposit_user_idx ON sandbox_payroll_deposits("userId", "createdAt");
