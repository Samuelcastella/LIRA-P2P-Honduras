import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs";

const read = (file) => fs.readFileSync(file, "utf8");
const deployment = JSON.parse(read("ops/deployment-contract.json"));
const reconciliation = JSON.parse(read("ops/backend-reconciliation.json"));
const failures = [];

function fail(message) {
  failures.push(message);
  console.error(`BACKEND_RECONCILIATION_VIOLATION: ${message}`);
}

function normalize(text) {
  return text.replace(/\r\n/g, "\n").trim();
}

function hash(text) {
  return createHash("sha256").update(normalize(text)).digest("hex");
}

function zipRead(file) {
  try {
    return execFileSync("unzip", ["-p", reconciliation.baselineArtifact, file], {
      encoding: "utf8",
      maxBuffer: 16 * 1024 * 1024,
    });
  } catch (error) {
    fail(`unable to read ${file} from ${reconciliation.baselineArtifact}`);
    return "";
  }
}

function zipEntries() {
  try {
    return execFileSync("unzip", ["-Z1", reconciliation.baselineArtifact], {
      encoding: "utf8",
      maxBuffer: 16 * 1024 * 1024,
    }).split(/\r?\n/).filter(Boolean);
  } catch {
    fail(`unable to list ${reconciliation.baselineArtifact}`);
    return [];
  }
}

function detectSchemaDialect(source) {
  if (/\bmysqlTable\b/.test(source)) return "mysql";
  if (/\bpgTable\b/.test(source)) return "postgresql";
  return "unknown";
}

function requireTokens(label, source, tokens) {
  for (const token of tokens) {
    if (!source.includes(token)) fail(`${label} is missing required contract token: ${token}`);
  }
}

if (!fs.existsSync(reconciliation.baselineArtifact)) {
  fail(`baseline artifact is missing: ${reconciliation.baselineArtifact}`);
}
if (deployment.principles?.sandboxOnly !== true || deployment.principles?.realMoneyEnabled !== false) {
  fail("deployment must remain sandbox-only while backend reconciliation is incomplete");
}

const baselineEntries = zipEntries();
const baselineServiceSourceFiles = baselineEntries.filter((entry) => /^(services|src\/services)\/(api|worker|reconciliation)\//.test(entry));

const rootPackage = JSON.parse(read("package.json"));
const baselinePackage = JSON.parse(zipRead("package.json"));
const requiredBackendScripts = reconciliation.serviceTopology?.requiredCanonicalBuildScripts ?? [];
const baselineBackendScripts = Object.fromEntries(requiredBackendScripts.map((name) => [name, Boolean(baselinePackage.scripts?.[name])]));
const canonicalBackendScripts = Object.fromEntries(requiredBackendScripts.map((name) => [name, Boolean(rootPackage.scripts?.[name])]));

for (const [name, present] of Object.entries(baselineBackendScripts)) {
  if (!present) fail(`hardened baseline unexpectedly lacks required service build script: ${name}`);
}
if (reconciliation.canonicalBackendMigrationReady) {
  for (const [name, present] of Object.entries(canonicalBackendScripts)) {
    if (!present) fail(`canonical backend migration cannot be ready without build script: ${name}`);
  }
}

const rootSchema = read("drizzle/schema.ts");
const baselineSchema = zipRead("drizzle/schema.ts");
const canonicalDialect = detectSchemaDialect(rootSchema);
const baselineDialect = detectSchemaDialect(baselineSchema);

if (canonicalDialect !== reconciliation.database?.canonicalDialect) {
  fail(`canonical database dialect drifted: detected ${canonicalDialect}, declared ${reconciliation.database?.canonicalDialect}`);
}
if (baselineDialect !== reconciliation.database?.baselineDialect) {
  fail(`baseline database dialect drifted: detected ${baselineDialect}, declared ${reconciliation.database?.baselineDialect}`);
}

const backendServices = ["lira-api", "lira-worker", "lira-reconciliation"];
if (!reconciliation.canonicalBackendMigrationReady) {
  if (canonicalDialect === baselineDialect) {
    console.log("NOTE: database dialects now match; migrationReady may be eligible for review, but remains false.");
  }
  for (const service of backendServices) {
    const artifact = deployment.services?.[service]?.artifactSource;
    if (artifact !== reconciliation.baselineArtifact) {
      fail(`${service} must remain archive-backed until canonicalBackendMigrationReady is explicitly approved`);
    }
  }
} else {
  if (canonicalDialect !== baselineDialect) {
    fail("canonicalBackendMigrationReady cannot be true while database dialects differ");
  }
}

for (const file of reconciliation.exactParityFiles ?? []) {
  const canonical = read(file);
  const baseline = zipRead(file);
  if (hash(canonical) !== hash(baseline)) {
    fail(`exact parity file drifted from hardened baseline: ${file}`);
  }
}

const schemaTokens = [
  "ledger_entries",
  "reconciliation_items",
  "provider_webhook_events",
  "outbox_events",
  "payment_requests",
  "trusted_devices",
  "otp_challenges",
  "audit_events",
];
requireTokens("canonical schema", rootSchema, schemaTokens);
requireTokens("hardened baseline schema", baselineSchema, schemaTokens);

const rootDomain = read("server/financial/domain.ts");
const baselineDomain = zipRead("server/financial/domain.ts");
for (const token of [
  "amountMinor",
  "currency",
  "idempotencyKey",
  "assertIdempotency",
  "createBalancedJournal",
  "assertBalancedJournal",
  "processing",
  "settled",
  "reversed",
]) {
  requireTokens("canonical financial domain", rootDomain, [token]);
  requireTokens("hardened financial domain", baselineDomain, [token]);
}

const rootProvider = read("server/financial/provider.ts");
const baselineProvider = zipRead("server/financial/provider.ts");
for (const token of ["SandboxBankAdapter", "verifyWebhookSignature", "unknown", "HNL"]) {
  requireTokens("canonical provider contract", rootProvider, [token]);
  requireTokens("hardened provider contract", baselineProvider, [token]);
}

const rootDb = read("server/db.ts");
const baselineDb = zipRead("server/db.ts");
for (const token of [
  "createSandboxTransfer",
  "createPaymentRequest",
  "consumeVerifiedTransferChallenge",
  "dispatchPendingSandboxOutbox",
  "reconciliationItems",
]) {
  requireTokens("canonical financial orchestration", rootDb, [token]);
  requireTokens("hardened financial orchestration", baselineDb, [token]);
}

const rootSecurity = read("server/security/deviceTrust.ts");
for (const token of [
  'status: "pending"',
  'status: "trusted"',
  'status === "restricted"',
  '"device_enrollment"',
  "assertDeviceEligibleForTrust",
  "assertTrustedDeviceState",
]) {
  requireTokens("canonical device trust implementation", rootSecurity, [token]);
}

console.log("Backend reconciliation evidence:");
console.log(JSON.stringify({
  baselineArtifact: reconciliation.baselineArtifact,
  baselineDialect,
  canonicalDialect,
  canonicalBackendMigrationReady: reconciliation.canonicalBackendMigrationReady,
  backendDeploySource: Object.fromEntries(backendServices.map((service) => [service, deployment.services?.[service]?.artifactSource ?? null])),
  exactParityFiles: reconciliation.exactParityFiles,
  semanticContractsChecked: reconciliation.semanticContracts?.length ?? 0,
  baselineBackendScripts,
  canonicalBackendScripts,
  serviceTopologyStatus: reconciliation.serviceTopology?.status ?? null,
  baselineServiceSourceFiles,
}, null, 2));

if (failures.length) {
  process.exitCode = 1;
} else {
  console.log("Backend reconciliation guard passed. Canonical backend migration remains gated.");
}
