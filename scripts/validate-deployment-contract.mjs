import fs from "node:fs";

const contract = JSON.parse(fs.readFileSync("ops/deployment-contract.json", "utf8"));
const read = (file) => fs.readFileSync(file, "utf8");
const fail = (message) => {
  console.error(`DEPLOYMENT_CONTRACT_VIOLATION: ${message}`);
  process.exitCode = 1;
};

if (contract.principles?.sandboxOnly !== true || contract.principles?.realMoneyEnabled !== false) {
  fail("deployment contract must remain sandbox-only with real money disabled");
}
if (contract.principles?.independentDeployUnits !== true) {
  fail("services must remain independent deployment units");
}

const web = read("Dockerfile.web");
for (const required of ["pnpm-workspace.yaml", "COPY patches ./patches", "pnpm install --frozen-lockfile", "pnpm exec vite build"]) {
  if (!web.includes(required)) fail(`Dockerfile.web is missing required build input/step: ${required}`);
}
if (web.includes("unzip") || web.includes("lira-p2p-honduras-hardened-v2.zip")) {
  fail("lira-web must not unpack or build from the hardened backend archive");
}
const installAt = web.indexOf("pnpm install --frozen-lockfile");
for (const requiredBeforeInstall of ["pnpm-workspace.yaml", "COPY patches ./patches"]) {
  const at = web.indexOf(requiredBeforeInstall);
  if (at === -1 || at > installAt) fail(`${requiredBeforeInstall} must be available before frozen install`);
}

for (const [service, dockerfile] of [
  ["lira-api", "Dockerfile.api"],
  ["lira-worker", "Dockerfile.worker"],
  ["lira-reconciliation", "Dockerfile.reconciliation"],
]) {
  const docker = read(dockerfile);
  if (!docker.includes("COPY lira-p2p-honduras-hardened-v2.zip /tmp/lira.zip")) {
    fail(`${service} must build from the hardened archive until its source migration is explicitly completed`);
  }
  if (/COPY\s+(?:client|server|package\.json|pnpm-lock\.yaml|pnpm-workspace\.yaml)(?:\s|$)/m.test(docker)) {
    fail(`${service} must not silently depend on canonical root/frontend files while archive-backed`);
  }
}

const expected = {
  "lira-api": ["Dockerfile.api", "lira-p2p-honduras-hardened-v2.zip"],
  "lira-worker": ["Dockerfile.worker", "lira-p2p-honduras-hardened-v2.zip"],
  "lira-reconciliation": ["Dockerfile.reconciliation", "lira-p2p-honduras-hardened-v2.zip"],
};
for (const [service, patterns] of Object.entries(expected)) {
  const actual = contract.services?.[service]?.watchPatterns;
  if (JSON.stringify(actual) !== JSON.stringify(patterns)) {
    fail(`${service} watchPatterns drifted from its real build inputs`);
  }
}

if (!process.exitCode) console.log("Deployment contract validation passed.");
