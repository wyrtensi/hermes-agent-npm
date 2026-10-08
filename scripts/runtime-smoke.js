#!/usr/bin/env node

const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const packageJson = require("../package.json");
const {
  getConsoleExecutable,
  getRuntimeEnvironment,
  getRuntimeSourceDirectory,
  getVenvDirectory
} = require("../lib/python-launcher");

const packageRoot = path.resolve(__dirname, "..");

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd || process.cwd(),
    env: options.env || process.env,
    encoding: "utf8",
    timeout: options.timeout || 30_000,
    windowsHide: true
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${command} failed: ${(result.stderr || result.stdout || "").trim()}`);
  }
  return result.stdout.trim();
}

const sourceDirectory = getRuntimeSourceDirectory();
const venvDirectory = getVenvDirectory();
const python = process.platform === "win32"
  ? path.join(venvDirectory, "Scripts", "python.exe")
  : path.join(venvDirectory, "bin", "python");
const hermes = getConsoleExecutable("hermes");

const installerManifest = process.platform === "win32"
  ? JSON.parse(run(
      "powershell.exe",
      [
        "-NoProfile",
        "-ExecutionPolicy", "Bypass",
        "-File", path.join(sourceDirectory, "scripts", "install.ps1"),
        "-Manifest"
      ],
      { cwd: packageRoot }
    ))
  : JSON.parse(run(
      "bash",
      [path.join(sourceDirectory, "scripts", "install.sh"), "--manifest"],
      { cwd: packageRoot }
    ));
if (!installerManifest.stages?.some((stage) => stage.name === "products")) {
  throw new Error("Pinned upstream installer does not expose the required products stage.");
}

for (const requiredPath of [path.join(sourceDirectory, ".git"), python, hermes]) {
  if (!fs.existsSync(requiredPath)) throw new Error(`Runtime path is missing: ${requiredPath}`);
}

const commit = run("git", ["-C", sourceDirectory, "rev-parse", "HEAD"]);
if (commit !== packageJson.hermesAgent.upstreamCommit) {
  throw new Error(`Runtime commit ${commit} does not match ${packageJson.hermesAgent.upstreamCommit}`);
}

run(
  python,
  [
    "-c",
    "import pathlib,sys; base=pathlib.Path(sys._base_executable).resolve(); root=pathlib.Path(sys.argv[1]).resolve(); assert root in base.parents, (base,root); import hermes_cli.main,run_agent",
    path.join(packageRoot, "runtime", "python")
  ],
  { env: getRuntimeEnvironment() }
);

run(hermes, ["--version"], { env: getRuntimeEnvironment() });
const smokeHome = path.join(packageRoot, "runtime", ".smoke-home");
fs.rmSync(smokeHome, { recursive: true, force: true });
try {
  run(hermes, ["update", "--check"], {
    env: { ...getRuntimeEnvironment(), HERMES_HOME: smokeHome },
    timeout: 120_000
  });
} finally {
  fs.rmSync(smokeHome, { recursive: true, force: true });
}
const status = JSON.parse(run(process.execPath, [path.join(packageRoot, "bin", "hermes-npm.js"), "status", "--json"]));
if (!status.runtimeReady || status.runtimeChannel !== "npm-release") {
  throw new Error(`Unexpected hermes-npm status: ${JSON.stringify(status)}`);
}
const methods = JSON.parse(run(process.execPath, [path.join(packageRoot, "bin", "hermes-npm.js"), "methods", "--json"]));
if (methods.recommendedForNpmUsers !== "npm-isolated" || methods.methods.length < 3) {
  throw new Error(`Unexpected hermes-npm methods: ${JSON.stringify(methods)}`);
}
const migrationPlan = JSON.parse(run(
  process.execPath,
  [path.join(packageRoot, "bin", "hermes-npm.js"), "migrate", "upstream", "--json"]
));
if (migrationPlan.upstreamCommit !== commit || migrationPlan.mode !== "one-way-upstream-handoff") {
  throw new Error(`Unexpected upstream migration plan: ${JSON.stringify(migrationPlan)}`);
}

console.log(`Runtime smoke test passed for ${packageJson.hermesAgent.upstreamGitTag} (${commit.slice(0, 12)}).`);
