const { spawn } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const packageJson = require("../package.json");
const { provisionRuntime } = require("./provision");

const packageRoot = path.resolve(__dirname, "..");
const DEFAULT_RUNTIME_DIRECTORY = "runtime/hermes-agent";

function resolveRuntimeSourceDirectory(root, runtimeDirectory = DEFAULT_RUNTIME_DIRECTORY) {
  return path.join(root, ...runtimeDirectory.split("/"));
}

function getRuntimeSourceDirectory() {
  return resolveRuntimeSourceDirectory(packageRoot, packageJson.hermesAgent?.runtimeDirectory || DEFAULT_RUNTIME_DIRECTORY);
}

function getVenvDirectory() {
  return path.join(getRuntimeSourceDirectory(), "venv");
}

function normalizeBinName(binName) {
  const baseName = path.basename(binName || "hermes-agent").toLowerCase();
  return baseName.replace(/(\.cmd|\.exe)$/i, "");
}

function venvConsoleExecutable(venvDirectory, binName, platform = process.platform) {
  const normalized = normalizeBinName(binName) === "hermes" ? "hermes" : "hermes-agent";
  if (platform === "win32") {
    return path.join(venvDirectory, "Scripts", `${normalized}.exe`);
  }
  return path.join(venvDirectory, "bin", normalized);
}

function getConsoleExecutable(binName, platform = process.platform) {
  return venvConsoleExecutable(getVenvDirectory(), binName, platform);
}

function buildConsoleInvocation(binName, userArgs, platform = process.platform) {
  return {
    command: getConsoleExecutable(binName, platform),
    args: [...userArgs]
  };
}

function getRuntimeEnvironment() {
  const env = {
    ...process.env,
    VIRTUAL_ENV: getVenvDirectory(),
    HERMES_NPM_BRIDGE: "1",
    HERMES_NPM_PACKAGE_ROOT: packageRoot,
    HERMES_NPM_PACKAGE_VERSION: packageJson.version,
    HERMES_NPM_RELEASE_TAG: packageJson.hermesAgent?.upstreamGitTag || ""
  };
  delete env.PYTHONHOME;
  delete env.PYTHONPATH;
  return env;
}

function autoSetupDisabled(env = process.env) {
  return ["0", "false", "no", "off"].includes(String(env.HERMES_NPM_AUTO_SETUP || "").toLowerCase());
}

function printRuntimeNotReady(reason) {
  console.error(`Hermes Agent isolated runtime is not ready${reason ? `: ${reason}` : "."}`);
  console.error("Run 'hermes-npm setup' to install it, or reinstall the npm package.");
}

// npm 12 blocks dependency install scripts by default, so a plain
// 'npm install' leaves only the command shims. Provision on first launch
// instead of failing; provisioning output goes to stderr so stdout stays
// reserved for the Hermes command itself.
function ensureRuntimeForLaunch(executable, options = {}) {
  if (fs.existsSync(executable)) return true;
  if (autoSetupDisabled(options.env)) {
    printRuntimeNotReady("automatic setup is disabled by HERMES_NPM_AUTO_SETUP");
    return false;
  }

  const result = (options.provisionRuntime || provisionRuntime)({
    packageRoot: options.packageRoot || packageRoot,
    isReady: () => fs.existsSync(executable),
    stdio: ["ignore", 2, 2],
    onWait: (lock) => {
      console.error(`Waiting for another Hermes Agent setup to finish${lock?.pid ? ` (pid ${lock.pid})` : ""}...`);
    },
    onStart: () => {
      console.error("Hermes Agent runtime is not installed yet; setting it up now (one-time download, usually 1-2 minutes)...");
    }
  });

  if (result.error) {
    printRuntimeNotReady(result.error);
    return false;
  }
  if (result.status !== 0) {
    printRuntimeNotReady(`setup failed with exit code ${result.status}`);
    return false;
  }
  if (!fs.existsSync(executable)) {
    printRuntimeNotReady(`setup finished but ${executable} is missing`);
    return false;
  }
  return true;
}

function runHermes(binName, userArgs, stdio = "inherit") {
  const invocation = buildConsoleInvocation(binName, userArgs);

  if (!ensureRuntimeForLaunch(invocation.command)) {
    process.exitCode = 1;
    return 1;
  }

  const child = spawn(invocation.command, invocation.args, {
    env: getRuntimeEnvironment(),
    stdio,
    windowsHide: false
  });

  child.on("exit", (code, signal) => {
    if (signal) {
      process.kill(process.pid, signal);
      return;
    }
    process.exit(code ?? 1);
  });

  child.on("error", (error) => {
    console.error(error.message);
    process.exit(1);
  });

  return 0;
}

module.exports = {
  autoSetupDisabled,
  buildConsoleInvocation,
  ensureRuntimeForLaunch,
  getConsoleExecutable,
  getRuntimeEnvironment,
  getRuntimeSourceDirectory,
  getVenvDirectory,
  normalizeBinName,
  resolveRuntimeSourceDirectory,
  runHermes,
  venvConsoleExecutable
};
