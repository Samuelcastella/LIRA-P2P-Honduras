import fs from "node:fs";

const readiness = JSON.parse(fs.readFileSync("ops/cutover-readiness.json", "utf8"));
const reconciliation = JSON.parse(fs.readFileSync("ops/backend-reconciliation.json", "utf8"));
const deployment = JSON.parse(fs.readFileSync("ops/deployment-contract.json", "utf8"));

const failures = [];
const fail = (message) => {
  failures.push(message);
  console.error(`CUTOVER_READINESS_VIOLATION: ${message}`);
};
const requireTokens = (label, source, tokens) => {
  for (const token of tokens) {
    if (!source.includes(token)) fail(`${label} is missing required token: ${token}`);
  }
};

if (readiness.mode !== "sandbox" || readiness.realMoneyEnabled !== false) {
  fail("cutover readiness must remain sandbox-only with real money disabled");
}
if (deployment.principles?.sandboxOnly !== true || deployment.principles?.realMoneyEnabled !== false) {
  fail("deployment contract must remain sandbox-only with real money disabled");
}

const mandatoryGates = [
  "mainCiGreen",
  "canonicalPostgres",
  "productionPostgresMajorParity",
  "workerReconciliationParity",
  "serviceTopology",
  "healthcheckCompatibility",
  "authContractParity",
  "deviceTrustOtpParity",
  "rollbackRunbook",
  "incidentResponseRunbook",
  "observabilityBaseline",
  "deploymentCiGate",
  "candidateImageSmoke",
  "backupRecoveryPoint",
  "restoreVerification",
];

for (const gate of mandatoryGates) {
  if (!readiness.gates?.[gate]) fail(`missing mandatory gate: ${gate}`);
}

const blockedGates = mandatoryGates.filter((gate) => readiness.gates?.[gate]?.status !== "verified");
const migrationReady = reconciliation.canonicalBackendMigrationReady === true;
const cutoverReady = readiness.cutover?.status === "ready";

if (cutoverReady && blockedGates.length > 0) {
  fail(`cutover cannot be ready while gates are not verified: ${blockedGates.join(", ")}`);
}

const backendServices = ["lira-api", "lira-worker", "lira-reconciliation"];
if (!migrationReady) {
  for (const service of backendServices) {
    if (deployment.services?.[service]?.artifactSource !== reconciliation.baselineArtifact) {
      fail(`${service} must remain backed by ${reconciliation.baselineArtifact} while canonicalBackendMigrationReady=false`);
    }
  }
}

// Migration approval and production cutover authorization are separate states.
// canonicalBackendMigrationReady may remain true while an operational cutover gate
// (for example Railway Wait for CI) is blocked. cutover.status must stay blocked
// until every mandatory operational gate is verified.

if (readiness.canonicalCandidate?.strategy !== "railway-dockerfile-path-switch") {
  fail("canonical cutover must use the reviewed Railway Dockerfile-path switch strategy");
}
if (readiness.canonicalCandidate?.rollbackStrategy !== "restore-archive-dockerfile-path-and-watch-patterns") {
  fail("canonical cutover must preserve the archive-backed rollback strategy");
}

for (const service of backendServices) {
  const baseline = readiness.productionBaseline?.services?.[service];
  if (!baseline?.serviceId || !baseline?.dockerfile || !baseline?.healthcheckPath) {
    fail(`production baseline is incomplete for ${service}`);
  }

  const candidate = readiness.canonicalCandidate?.services?.[service];
  if (!candidate?.dockerfile || !candidate?.healthcheckPath) {
    fail(`canonical candidate is incomplete for ${service}`);
    continue;
  }
  if (candidate.healthcheckPath !== baseline.healthcheckPath) {
    fail(`${service} candidate health path must preserve the production contract`);
  }
  if (!fs.existsSync(candidate.dockerfile)) {
    fail(`${service} candidate Dockerfile is missing: ${candidate.dockerfile}`);
    continue;
  }

  const dockerfile = fs.readFileSync(candidate.dockerfile, "utf8");
  requireTokens(`${service} candidate Dockerfile`, dockerfile, [
    "pnpm install --frozen-lockfile",
    "pnpm prune --prod",
    "LIRA_SANDBOX_ONLY=true",
    "LIRA_REAL_MONEY_ENABLED=false",
    "USER node",
  ]);
  if (dockerfile.includes("lira-p2p-honduras-hardened-v2.zip")) {
    fail(`${service} candidate Dockerfile must build from canonical source, not the hardened archive`);
  }
}

const apiCandidate = readiness.canonicalCandidate?.services?.["lira-api"];
if (apiCandidate?.preDeployCommand !== "node scripts/migrate.mjs") {
  fail("canonical API candidate must preserve Railway pre-deploy migrations");
}
if (apiCandidate?.dockerfile && fs.existsSync(apiCandidate.dockerfile)) {
  requireTokens("lira-api candidate migration assets", fs.readFileSync(apiCandidate.dockerfile, "utf8"), [
    "/workspace/scripts ./scripts",
    "/workspace/db ./db",
  ]);
}
if (!fs.existsSync("db/migrations/001_initial_postgres.sql")) {
  fail("canonical PostgreSQL migration directory is missing");
}

for (const gate of ["deploymentCiGate", "candidateImageSmoke", "backupRecoveryPoint", "restoreVerification"]) {
  const item = readiness.gates?.[gate];
  if (item?.status === "verified" && !item.evidence?.trim()) {
    fail(`${gate} cannot be verified without evidence`);
  }
}

console.log(JSON.stringify({
  migrationReady,
  cutoverStatus: readiness.cutover?.status,
  blockedGates,
  artifactSource: reconciliation.baselineArtifact,
  candidateStrategy: readiness.canonicalCandidate?.strategy,
}, null, 2));

if (failures.length) process.exitCode = 1;
else console.log("Cutover readiness guard passed.");
