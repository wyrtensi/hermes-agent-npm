const { spawn } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const packageJson = require("../package.json");

const packageRoot = path.resolve(__dirname, "..");

function getRuntimeSourceDirectory() {
  const configured = packageJson.hermesAgent?.runtimeDirectory || "runtime/hermes-agent";
  return path.join(packageRoot, ...configured.split("/"));
}

function getVenvDirectory() {
  return path.join(getRuntimeSourceDirectory(), "venv");
}

function normalizeBinName(binName) {
  const baseName = path.basename(binName || "hermes-agent").toLowerCase();
  return baseName.replace(/(\.cmd|\.exe)$/i, "");
}

function getConsoleExecutable(binName, platform = process.platform) {
  const normalized = normalizeBinName(binName) === "hermes" ? "hermes" : "hermes-agent";
  if (platform === "win32") {
    return path.join(getVenvDirectory(), "Scripts", `${normalized}.exe`);
  }
  return path.join(getVenvDirectory(), "bin", normalized);
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

function runHermes(binName, userArgs, stdio = "inherit") {
  const invocation = buildConsoleInvocation(binName, userArgs);

  if (!fs.existsSync(invocation.command)) {
    console.error("Hermes Agent isolated runtime is not ready.");
    console.error("Run 'npm rebuild hermes-agent' or reinstall the npm package.");
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
  buildConsoleInvocation,
  getConsoleExecutable,
  getRuntimeEnvironment,
  getRuntimeSourceDirectory,
  getVenvDirectory,
  normalizeBinName,
  runHermes
};
