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

function dockerInstructions(source) {
  return source
    .replace(/\\\r?\n\s*/g, " ")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"));
}

function copySources(source) {
  const result = [];
  for (const instruction of dockerInstructions(source)) {
    if (!/^COPY\s+/i.test(instruction)) continue;
    let rest = instruction.replace(/^COPY\s+/i, "");
    let fromStage = false;

    while (rest.startsWith("--")) {
      const match = rest.match(/^(--[^\s]+)\s+(.*)$/);
      if (!match) break;
      if (match[1].startsWith("--from=")) fromStage = true;
      rest = match[2];
    }
    if (fromStage) continue;

    if (rest.startsWith("[")) {
      try {
        const values = JSON.parse(rest);
        if (!Array.isArray(values) || values.length < 2 || values.some((value) => typeof value !== "string")) {
          fail(`invalid JSON COPY instruction: ${instruction}`);
          continue;
        }
        result.push(...values.slice(0, -1));
      } catch {
        fail(`invalid JSON COPY instruction: ${instruction}`);
      }
      continue;
    }

    const tokens = rest.match(/"[^"]*"|'[^']*'|\S+/g)?.map((token) => token.replace(/^["']|["']$/g, "")) ?? [];
    if (tokens.length < 2) {
      fail(`unable to parse COPY instruction: ${instruction}`);
      continue;
    }
    result.push(...tokens.slice(0, -1));
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

const archiveServices = ["lira-api", "lira-worker", "lira-reconciliation"];
for (const service of archiveServices) {
  const serviceContract = contract.services?.[service];
  if (!serviceContract?.dockerfile || !serviceContract?.artifactSource) {
    fail(`${service} must declare dockerfile and artifactSource`);
    continue;
  }
  if (!fs.existsSync(serviceContract.dockerfile)) {
    fail(`${service} declares missing Dockerfile: ${serviceContract.dockerfile}`);
    continue;
  }
  if (!fs.existsSync(serviceContract.artifactSource)) {
    fail(`${service} declares missing artifact: ${serviceContract.artifactSource}`);
  }

  const docker = read(serviceContract.dockerfile);
  const sources = copySources(docker);
  if (!sources.includes(serviceContract.artifactSource)) {
    fail(`${service} must copy its declared archive source ${serviceContract.artifactSource}`);
  }
  const unexpected = sources.filter((source) => source !== serviceContract.artifactSource);
  if (unexpected.length) {
    fail(`${service} archive-backed Dockerfile has undeclared build-context COPY source(s): ${unexpected.join(", ")}`);
  }
}

const expectedWatchPatterns = {
  "lira-web": [
    "client/**",
    "shared/**",
    "apps/web/**",
    "Dockerfile.web",
    "package.json",
    "pnpm-lock.yaml",
    "pnpm-workspace.yaml",
    "patches/**",
    "tsconfig.json",
    "vite.config.ts",
    "components.json",
  ],
  ...Object.fromEntries(archiveServices.map((service) => {
    const serviceContract = contract.services?.[service] ?? {};
    return [service, [serviceContract.dockerfile, serviceContract.artifactSource]];
  })),
};

for (const [service, patterns] of Object.entries(expectedWatchPatterns)) {
  const actual = contract.services?.[service]?.watchPatterns;
  if (JSON.stringify(actual) !== JSON.stringify(patterns)) {
    fail(`${service} watchPatterns drifted from its complete build-input contract`);
  }
}

if (!process.exitCode) console.log("Deployment contract validation passed.");
