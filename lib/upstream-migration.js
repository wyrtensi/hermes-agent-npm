const { spawn } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const packageJson = require("../package.json");
const { getRuntimeSourceDirectory } = require("./python-launcher");

const packageRoot = path.resolve(__dirname, "..");
const upstreamRepositoryUrls = new Set([
  "https://github.com/NastechResearch/nastech-agent",
  "https://github.com/NastechResearch/nastech-agent.git",
  "git@github.com:NastechResearch/nastech-agent.git",
  "ssh://git@github.com/NastechResearch/nastech-agent.git"
]);

function npmCommand(platform = process.platform) {
  return platform === "win32" ? "npm.cmd" : "npm";
}

function platformPath(platform = process.platform) {
  return platform === "win32" ? path.win32 : path.posix;
}

function getDefaultNastechHome(platform = process.platform, env = process.env, home = os.homedir()) {
  const paths = platformPath(platform);
  if (env.NASTECH_HOME) return paths.resolve(env.NASTECH_HOME);
  if (platform === "win32") {
    return paths.resolve(env.LOCALAPPDATA || paths.join(home, "AppData", "Local"), "nastech");
  }
  return paths.resolve(home, ".nastech");
}

function isPathInside(parent, candidate, platform = process.platform) {
  const paths = platformPath(platform);
  const relative = paths.relative(paths.resolve(parent), paths.resolve(candidate));
  if (relative === "") return true;
  if (relative === ".." || relative.startsWith(`..${paths.sep}`) || paths.isAbsolute(relative)) return false;
  return true;
}

function getOfficialConsoleExecutable(installDirectory, platform = process.platform) {
  const paths = platformPath(platform);
  return platform === "win32"
    ? paths.join(installDirectory, "venv", "Scripts", "nastech.exe")
    : paths.join(installDirectory, "venv", "bin", "nastech");
}

function getUpstreamInstallerInvocation(plan, platform = process.platform) {
  if (platform === "win32") {
    return {
      command: "powershell.exe",
      args: [
        "-NoProfile",
        "-ExecutionPolicy", "Bypass",
        "-File", plan.installerPath,
        "-Commit", plan.upstreamCommit,
        "-ForceCommit",
        "-SkipSetup",
        "-NonInteractive",
        "-InstallDir", plan.installDirectory,
        "-NastechHome", plan.nastechHome
      ]
    };
  }
  return {
    command: "bash",
    args: [
      plan.installerPath,
      "--commit", plan.upstreamCommit,
      "--force-commit",
      "--skip-setup",
      "--non-interactive",
      "--dir", plan.installDirectory,
      "--nastech-home", plan.nastechHome
    ]
  };
}

function getUpstreamPathInvocation(plan, platform = process.platform) {
  const paths = platformPath(platform);
  const stage = plan.installerFinalizeStage || "path";
  const installedScript = platform === "win32"
    ? paths.join(plan.installDirectory, "scripts", "install.ps1")
    : paths.join(plan.installDirectory, "scripts", "install.sh");
  if (platform === "win32") {
    return {
      command: "powershell.exe",
      args: [
        "-NoProfile",
        "-ExecutionPolicy", "Bypass",
        "-File", installedScript,
        "-Stage", stage,
        "-NonInteractive",
        "-InstallDir", plan.installDirectory,
        "-NastechHome", plan.nastechHome
      ]
    };
  }
  return {
    command: "bash",
    args: [
      installedScript,
      "--stage", stage,
      "--non-interactive",
      "--dir", plan.installDirectory,
      "--nastech-home", plan.nastechHome
    ]
  };
}

function getNpmUninstallArgs(context, packageName = packageJson.name) {
  const args = ["uninstall"];
  if (context.isGlobal) args.push("--global");
  args.push(packageName);
  return args;
}

function createUpstreamMigrationPlan(context, options = {}) {
  const platform = options.platform || process.platform;
  const paths = platformPath(platform);
  const nastechHome = getDefaultNastechHome(platform, options.env || process.env, options.home || os.homedir());
  const installDirectory = paths.join(nastechHome, "nastech-agent");
  const sourceDirectory = getRuntimeSourceDirectory();
  const installerPath = platform === "win32"
    ? paths.join(sourceDirectory, "scripts", "install.ps1")
    : paths.join(sourceDirectory, "scripts", "install.sh");
  const plan = {
    mode: "one-way-upstream-handoff",
    from: "npm-isolated",
    to: "upstream-managed",
    platform,
    npmPackage: packageJson.name,
    npmVersion: packageJson.version,
    upstreamRelease: packageJson.nastechAgent.upstreamGitTag,
    upstreamCommit: packageJson.nastechAgent.upstreamCommit,
    installerFinalizeStage: packageJson.nastechAgent.installerFinalizeStage || "path",
    nastechHome,
    installDirectory,
    installerPath,
    consoleExecutable: getOfficialConsoleExecutable(installDirectory, platform),
    npmManagedInstall: Boolean(context.isGlobal || context.projectRoot),
    installScope: context.isGlobal ? "global" : "local",
    npmWorkingDirectory: context.projectRoot || process.cwd()
  };
  plan.installer = getUpstreamInstallerInvocation(plan, platform);
  plan.finalizePath = getUpstreamPathInvocation(plan, platform);
  plan.npmUninstall = {
    command: npmCommand(platform),
    args: getNpmUninstallArgs(context)
  };
  return plan;
}

function spawnAndWait(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd || process.cwd(),
      env: options.env || process.env,
      stdio: options.stdio || "inherit",
      windowsHide: false
    });
    child.on("error", reject);
    child.on("exit", (code, signal) => {
      if (signal) {
        reject(new Error(`${command} terminated by signal ${signal}`));
        return;
      }
      if (code !== 0) {
        reject(new Error(`${command} exited with code ${code ?? 1}`));
        return;
      }
      resolve();
    });
  });
}

function normalizeRepositoryUrl(value) {
  return (value || "").trim().replace(/\/$/, "");
}

function quotePosixArgument(value) {
  return `'${value.replace(/'/gu, `'"'"'`)}'`;
}

function quotePowerShellArgument(value) {
  return `'${value.replace(/'/gu, "''")}'`;
}

function formatInvocation(invocation, platform = process.platform) {
  const values = [invocation.command, ...invocation.args];
  if (platform === "win32") {
    return `& ${values.map(quotePowerShellArgument).join(" ")}`;
  }
  return values.map(quotePosixArgument).join(" ");
}

function resolveThroughExistingAncestor(target) {
  let current = path.resolve(target);
  const missingSegments = [];
  while (!fs.existsSync(current)) {
    const parent = path.dirname(current);
    if (parent === current) break;
    missingSegments.unshift(path.basename(current));
    current = parent;
  }
  const resolvedAncestor = fs.realpathSync.native(current);
  return path.resolve(resolvedAncestor, ...missingSegments);
}

function inspectExistingTarget(plan, runGit) {
  if (!fs.existsSync(plan.installDirectory)) return { exists: false, kind: "absent" };
  if (!fs.existsSync(path.join(plan.installDirectory, ".git"))) {
    throw new Error(
      `Refusing to replace the existing non-Git directory at ${plan.installDirectory}. ` +
      "Move or remove it explicitly, then retry."
    );
  }
  const origin = normalizeRepositoryUrl(runGit(["-C", plan.installDirectory, "remote", "get-url", "origin"]));
  if (!upstreamRepositoryUrls.has(origin)) {
    throw new Error(`Refusing to modify ${plan.installDirectory}: unexpected Git origin ${origin || "unknown"}.`);
  }
  const dirty = runGit(["-C", plan.installDirectory, "status", "--porcelain"]);
  if (dirty === null) {
    throw new Error(`Refusing to modify ${plan.installDirectory}: Git status could not be verified.`);
  }
  if (dirty !== "") {
    throw new Error(
      `Refusing to modify the dirty upstream checkout at ${plan.installDirectory}. ` +
      "Commit, stash, or remove its changes explicitly, then retry."
    );
  }
  return { exists: true, kind: "upstream-checkout", origin };
}

function assertMigrationPreconditions(plan, runtimeStatus, runGit) {
  if (!plan.npmManagedInstall) {
    throw new Error(
      "The command is not running from an npm-managed node_modules installation; refusing to modify or uninstall the source checkout."
    );
  }
  if (runtimeStatus.runtimeChannel !== "npm-release") {
    throw new Error(
      "The npm runtime is not at its release-pinned commit. Run 'nastech-npm update', then retry the migration."
    );
  }
  if (!fs.existsSync(plan.installerPath)) {
    throw new Error(`Pinned upstream installer is missing: ${plan.installerPath}`);
  }
  const canonicalPackageRoot = resolveThroughExistingAncestor(packageRoot);
  const canonicalNastechHome = resolveThroughExistingAncestor(plan.nastechHome);
  const canonicalInstallDirectory = resolveThroughExistingAncestor(plan.installDirectory);
  if (
    isPathInside(packageRoot, plan.nastechHome, plan.platform) ||
    isPathInside(packageRoot, plan.installDirectory, plan.platform) ||
    isPathInside(canonicalPackageRoot, canonicalNastechHome, plan.platform) ||
    isPathInside(canonicalPackageRoot, canonicalInstallDirectory, plan.platform)
  ) {
    throw new Error(
      "NASTECH_HOME or its install target resolves inside the npm package and would be removed with it; " +
      "choose an external NASTECH_HOME."
    );
  }
  return inspectExistingTarget(plan, runGit);
}

async function executeUpstreamMigration(plan, helpers) {
  const existingTarget = assertMigrationPreconditions(plan, helpers.runtimeStatus, helpers.runGit);
  await (helpers.spawnAndWait || spawnAndWait)(plan.installer.command, plan.installer.args, {
    cwd: packageRoot,
    env: process.env
  });

  const installedCommit = helpers.runGit(["-C", plan.installDirectory, "rev-parse", "HEAD"]);
  const installedDirty = helpers.runGit(["-C", plan.installDirectory, "status", "--porcelain"]);
  if (
    installedCommit !== plan.upstreamCommit ||
    installedDirty !== "" ||
    !fs.existsSync(plan.consoleExecutable)
  ) {
    throw new Error(
      "The upstream installer completed, but a clean exact commit or Nastech console executable could not be verified. " +
      "The npm package was kept."
    );
  }

  let uninstallError = null;
  try {
    await (helpers.spawnAndWait || spawnAndWait)(plan.npmUninstall.command, plan.npmUninstall.args, {
      cwd: plan.npmWorkingDirectory,
      env: process.env
    });
  } catch (error) {
    uninstallError = error;
  }
  try {
    await (helpers.spawnAndWait || spawnAndWait)(plan.finalizePath.command, plan.finalizePath.args, {
      cwd: plan.installDirectory,
      env: process.env
    });
  } catch (error) {
    const state = uninstallError
      ? "npm removal failed and the official products stage also failed"
      : "npm ownership was removed, but the official products stage failed";
    throw new Error(
      `${state}: ${error.message}. ` +
      `Run ${formatInvocation(plan.finalizePath, plan.platform)} manually.`
    );
  }
  if (uninstallError) {
    throw new Error(
      `The upstream deployment was verified, but npm removal failed: ${uninstallError.message}. ` +
      `Run ${formatInvocation(plan.npmUninstall, plan.platform)} manually, then ` +
      `${formatInvocation(plan.finalizePath, plan.platform)}.`
    );
  }
  return { existingTarget, installedCommit };
}

module.exports = {
  assertMigrationPreconditions,
  createUpstreamMigrationPlan,
  executeUpstreamMigration,
  formatInvocation,
  getDefaultNastechHome,
  getNpmUninstallArgs,
  getOfficialConsoleExecutable,
  getUpstreamInstallerInvocation,
  getUpstreamPathInvocation,
  inspectExistingTarget,
  isPathInside,
  normalizeRepositoryUrl,
  platformPath,
  quotePosixArgument,
  quotePowerShellArgument,
  resolveThroughExistingAncestor,
  spawnAndWait
};
