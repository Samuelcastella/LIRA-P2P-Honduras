import fs from "node:fs";

const contract = JSON.parse(fs.readFileSync("ops/deployment-contract.json", "utf8"));
const reconciliation = JSON.parse(fs.readFileSync("ops/backend-reconciliation.json", "utf8"));
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

function dockerInstructions(source) {
  return source
    .replace(/\\\r?\n\s*/g, " ")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"));
}

function parseCopySources(instruction) {
  let rest = instruction.replace(/^COPY\s+/i, "");
  let fromStage = false;

  while (rest.startsWith("--")) {
    const match = rest.match(/^(--[^\s]+)\s+(.*)$/);
    if (!match) break;
    if (match[1].startsWith("--from=")) fromStage = true;
    rest = match[2];
  }
  if (fromStage) return [];

  if (rest.startsWith("[")) {
    try {
      const values = JSON.parse(rest);
      if (!Array.isArray(values) || values.length < 2 || values.some((value) => typeof value !== "string")) {
        fail(`invalid JSON COPY instruction: ${instruction}`);
        return [];
      }
      return values.slice(0, -1);
    } catch {
      fail(`invalid JSON COPY instruction: ${instruction}`);
      return [];
    }
  }

  const tokens = rest.match(/"[^"]*"|'[^']*'|\S+/g)?.map((token) => token.replace(/^["']|["']$/g, "")) ?? [];
  if (tokens.length < 2) {
    fail(`unable to parse COPY instruction: ${instruction}`);
    return [];
  }
  return tokens.slice(0, -1);
}

function buildContextSources(source, { rejectAdd = false } = {}) {
  const result = [];
  for (const instruction of dockerInstructions(source)) {
    if (/^ADD\s+/i.test(instruction)) {
      if (rejectAdd) {
        fail(`archive-backed Dockerfile must not use ADD: ${instruction}`);
      }
      continue;
    }
    if (/^COPY\s+/i.test(instruction)) {
      result.push(...parseCopySources(instruction));
    }
  }
  return result;
}

const webService = contract.services?.["lira-web"];
if (!webService || webService.dockerfile !== "Dockerfile.web" || webService.artifactSource !== "canonical-repository") {
  fail("lira-web must declare Dockerfile.web and canonical-repository as its build source");
}
const web = read(webService?.dockerfile ?? "Dockerfile.web");
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

const backendServices = ["lira-api", "lira-worker", "lira-reconciliation"];
const canonicalCutoverApproved = reconciliation.canonicalBackendMigrationReady === true;

for (const service of backendServices) {
  const serviceContract = contract.services?.[service];
  if (!serviceContract?.dockerfile || !serviceContract?.artifactSource) {
    fail(`${service} must declare dockerfile and artifactSource`);
    continue;
  }
  if (!fs.existsSync(serviceContract.dockerfile)) {
    fail(`${service} declares missing Dockerfile: ${serviceContract.dockerfile}`);
    continue;
  }

  const docker = read(serviceContract.dockerfile);
  const isArchiveBacked = serviceContract.artifactSource === reconciliation.baselineArtifact;
  const isCanonical = serviceContract.artifactSource === "canonical-repository";

  if (!isArchiveBacked && !isCanonical) {
    fail(`${service} artifactSource must be either ${reconciliation.baselineArtifact} or canonical-repository`);
    continue;
  }

  if (!canonicalCutoverApproved && isCanonical) {
    fail(`${service} cannot declare canonical-repository before canonical backend migration is approved`);
    continue;
  }

  if (isArchiveBacked) {
    if (!fs.existsSync(serviceContract.artifactSource)) {
      fail(`${service} declares missing archive artifact: ${serviceContract.artifactSource}`);
    }
    const sources = buildContextSources(docker, { rejectAdd: true });
    if (!sources.includes(serviceContract.artifactSource)) {
      fail(`${service} must COPY its declared archive source ${serviceContract.artifactSource}`);
    }
    const unexpected = sources.filter((source) => source !== serviceContract.artifactSource);
    if (unexpected.length) {
      fail(`${service} archive-backed Dockerfile has undeclared build-context COPY source(s): ${unexpected.join(", ")}`);
    }
    const expected = [serviceContract.dockerfile, ".dockerignore", serviceContract.artifactSource];
    if (JSON.stringify(serviceContract.watchPatterns) !== JSON.stringify(expected)) {
      fail(`${service} watchPatterns drifted from its archive-backed build-input contract`);
    }
    continue;
  }

  if (docker.includes(reconciliation.baselineArtifact) || /\bunzip\b/.test(docker)) {
    fail(`${service} canonical Dockerfile must not depend on the hardened archive`);
  }
  const requiredPatterns = [
    serviceContract.dockerfile,
    ".dockerignore",
    "package.json",
    "pnpm-lock.yaml",
    "pnpm-workspace.yaml",
    "shared/**",
    "server/**",
    "drizzle/**",
  ];
  for (const pattern of requiredPatterns) {
    if (!serviceContract.watchPatterns?.includes(pattern)) {
      fail(`${service} canonical watchPatterns must include ${pattern}`);
    }
  }
}

const expectedWebPatterns = [
  "client/**",
  "shared/**",
  "apps/web/**",
  "Dockerfile.web",
  ".dockerignore",
  "package.json",
  "pnpm-lock.yaml",
  "pnpm-workspace.yaml",
  "patches/**",
  "tsconfig.json",
  "vite.config.ts",
  "components.json",
];
if (JSON.stringify(webService?.watchPatterns) !== JSON.stringify(expectedWebPatterns)) {
  fail("lira-web watchPatterns drifted from its complete build-input contract");
}

if (!process.exitCode) {
  const canonicalServices = backendServices.filter(
    (service) => contract.services?.[service]?.artifactSource === "canonical-repository",
  );
  const mode = canonicalServices.length === 0
    ? "archive"
    : canonicalServices.length === backendServices.length
      ? "canonical"
      : `progressive-canonical:${canonicalServices.join(",")}`;
  console.log(`Deployment contract validation passed (backend mode: ${mode}).`);
}
