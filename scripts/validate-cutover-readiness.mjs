import fs from "node:fs";

const readiness = JSON.parse(fs.readFileSync("ops/cutover-readiness.json", "utf8"));
const reconciliation = JSON.parse(fs.readFileSync("ops/backend-reconciliation.json", "utf8"));
const deployment = JSON.parse(fs.readFileSync("ops/deployment-contract.json", "utf8"));

const failures = [];
const fail = (message) => {
  failures.push(message);
  console.error(`CUTOVER_READINESS_VIOLATION: ${message}`);
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
  "workerReconciliationParity",
  "serviceTopology",
  "healthcheckCompatibility",
  "authContractParity",
  "deviceTrustOtpParity",
  "rollbackRunbook",
  "incidentResponseRunbook",
  "observabilityBaseline",
  "backupRecoveryPoint",
  "restoreVerification",
];

for (const gate of mandatoryGates) {
  if (!readiness.gates?.[gate]) fail(`missing mandatory gate: ${gate}`);
}

const blockedGates = mandatoryGates.filter((gate) => readiness.gates?.[gate]?.status !== "verified");
const migrationReady = reconciliation.canonicalBackendMigrationReady === true;
const cutoverReady = readiness.cutover?.status === "ready";

if ((migrationReady || cutoverReady) && blockedGates.length > 0) {
  fail(`migration/cutover cannot be ready while gates are not verified: ${blockedGates.join(", ")}`);
}

const backendServices = ["lira-api", "lira-worker", "lira-reconciliation"];
if (!migrationReady) {
  for (const service of backendServices) {
    if (deployment.services?.[service]?.artifactSource !== reconciliation.baselineArtifact) {
      fail(`${service} must remain backed by ${reconciliation.baselineArtifact} while canonicalBackendMigrationReady=false`);
    }
  }
}

if (readiness.cutover?.status === "blocked" && migrationReady) {
  fail("canonicalBackendMigrationReady cannot be true while cutover status is blocked");
}

for (const service of backendServices) {
  const baseline = readiness.productionBaseline?.services?.[service];
  if (!baseline?.serviceId || !baseline?.dockerfile || !baseline?.healthcheckPath) {
    fail(`production baseline is incomplete for ${service}`);
  }
}

const backupGate = readiness.gates?.backupRecoveryPoint;
if (backupGate?.status === "verified" && !backupGate.evidence?.trim()) {
  fail("backupRecoveryPoint cannot be verified without evidence");
}
const restoreGate = readiness.gates?.restoreVerification;
if (restoreGate?.status === "verified" && !restoreGate.evidence?.trim()) {
  fail("restoreVerification cannot be verified without evidence");
}

console.log(JSON.stringify({
  migrationReady,
  cutoverStatus: readiness.cutover?.status,
  blockedGates,
  artifactSource: reconciliation.baselineArtifact,
}, null, 2));

if (failures.length) process.exitCode = 1;
else console.log("Cutover readiness guard passed.");
