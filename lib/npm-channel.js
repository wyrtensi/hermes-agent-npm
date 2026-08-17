const { spawn, spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const packageJson = require("../package.json");
const { getRuntimeSourceDirectory } = require("./python-launcher");
const {
  createUpstreamMigrationPlan,
  executeUpstreamMigration,
  getDefaultHermesHome
} = require("./upstream-migration");

const packageRoot = path.resolve(__dirname, "..");
const npmRegistry = "https://registry.npmjs.org";
const canonicalPackageName = packageJson.hermesAgent?.canonicalNpmPackage || packageJson.name;

function npmCommand() {
  return process.platform === "win32" ? "npm.cmd" : "npm";
}

function runGit(args, options = {}) {
  const env = {
    ...process.env,
    GIT_TERMINAL_PROMPT: "0",
    GCM_INTERACTIVE: "Never"
  };
  delete env.GIT_DIR;
  delete env.GIT_WORK_TREE;
  delete env.GIT_INDEX_FILE;
  const result = spawnSync("git", args, {
    encoding: "utf8",
    env,
    windowsHide: true
  });
  if (result.status !== 0) return null;
  return options.trim === false ? result.stdout.replace(/\r?\n$/u, "") : result.stdout.trim();
}

function parseGitStatusPorcelain(output) {
  if (!output) return [];
  return output.split(/\r?\n/u).filter((line) => line.length > 0);
}

function isReleasePinned(runtimeReady, runtimeCommit, packagedCommit, runtimeDirtyPaths) {
  return Boolean(
    runtimeReady &&
    runtimeCommit === packagedCommit &&
    Array.isArray(runtimeDirtyPaths) &&
    runtimeDirtyPaths.length === 0
  );
}

function findNodeModulesOwner(startPath) {
  let current = path.resolve(startPath);
  while (true) {
    if (path.basename(current).toLowerCase() === "node_modules") {
      return path.dirname(current);
    }
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

function pathsReferToSameInstallLocation(left, right, platform = process.platform) {
  if (!left || !right) return false;
  return platform === "win32"
    ? left.toLowerCase() === right.toLowerCase()
    : left === right;
}

function detectInstallContext() {
  const result = spawnSync(npmCommand(), ["root", "--global"], {
    encoding: "utf8",
    windowsHide: true
  });
  const globalRoot = result.status === 0 ? path.resolve(result.stdout.trim()) : null;
  const packageParent = path.dirname(packageRoot);
  const isGlobal = pathsReferToSameInstallLocation(packageParent, globalRoot);
  return {
    isGlobal,
    projectRoot: isGlobal ? null : findNodeModulesOwner(packageRoot)
  };
}

function getReleaseUpdateCommand() {
  return "hermes-npm update";
}

function getReleaseUpdateArgs(version, context = detectInstallContext(), packageName = canonicalPackageName) {
  parseSemver(version);
  const args = ["install"];
  if (context.isGlobal) args.push("--global");
  args.push("--registry", npmRegistry, `${packageName}@${version}`);
  return args;
}

function getAliasMigrationCommands(
  version,
  context,
  installedPackageName = packageJson.name,
  canonicalName = canonicalPackageName
) {
  if (installedPackageName === canonicalName) return null;
  const uninstallArgs = ["uninstall"];
  if (context.isGlobal) uninstallArgs.push("--global");
  uninstallArgs.push(installedPackageName);
  const installArgs = getReleaseUpdateArgs(version, context, canonicalName);
  return [
    `npm ${uninstallArgs.join(" ")}`,
    `npm ${installArgs.join(" ")}`
  ];
}

function assertReleaseUpdateAllowed(
  version,
  context,
  installedPackageName = packageJson.name,
  canonicalName = canonicalPackageName
) {
  const commands = getAliasMigrationCommands(version, context, installedPackageName, canonicalName);
  if (!commands) return;
  throw new Error(
    `${installedPackageName} is an alias for ${canonicalName} and cannot update automatically. ` +
    `Migrate manually:\n  ${commands.join("\n  ")}`
  );
}

function parseSemver(version) {
  const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(version);
  if (!match) throw new Error(`Invalid npm semver: ${version}`);
  return {
    core: match.slice(1, 4).map(Number),
    prerelease: match[4] ? match[4].split(".") : []
  };
}

function compareSemver(left, right) {
  const a = parseSemver(left);
  const b = parseSemver(right);
  for (let index = 0; index < 3; index += 1) {
    if (a.core[index] !== b.core[index]) return a.core[index] > b.core[index] ? 1 : -1;
  }
  if (a.prerelease.length === 0 || b.prerelease.length === 0) {
    if (a.prerelease.length === b.prerelease.length) return 0;
    return a.prerelease.length === 0 ? 1 : -1;
  }
  const length = Math.max(a.prerelease.length, b.prerelease.length);
  for (let index = 0; index < length; index += 1) {
    const av = a.prerelease[index];
    const bv = b.prerelease[index];
    if (av === undefined || bv === undefined) return av === undefined ? -1 : 1;
    if (av === bv) continue;
    const an = /^\d+$/.test(av);
    const bn = /^\d+$/.test(bv);
    if (an && bn) return Number(av) > Number(bv) ? 1 : -1;
    if (an !== bn) return an ? -1 : 1;
    return av > bv ? 1 : -1;
  }
  return 0;
}

function readRuntimeStatus() {
  const sourceDirectory = getRuntimeSourceDirectory();
  const hermesHome = getDefaultHermesHome();
  const markerPath = path.join(packageRoot, ".hermes-agent-runtime.json");
  let marker = null;
  try {
    marker = JSON.parse(fs.readFileSync(markerPath, "utf8"));
  } catch {
    marker = null;
  }

  const runtimeCommit = runGit(["-C", sourceDirectory, "rev-parse", "HEAD"]);
  const branch = runGit(["-C", sourceDirectory, "branch", "--show-current"]);
  const dirty = runGit(
    ["-C", sourceDirectory, "status", "--porcelain", "--untracked-files=no"],
    { trim: false }
  );
  const runtimeDirtyPaths = dirty === null ? null : parseGitStatusPorcelain(dirty);
  const packagedCommit = packageJson.hermesAgent?.upstreamCommit || null;
  const runtimeReady = Boolean(runtimeCommit && marker);
  const releasePinned = isReleasePinned(
    runtimeReady,
    runtimeCommit,
    packagedCommit,
    runtimeDirtyPaths
  );
  const context = detectInstallContext();

  return {
    installation: "npm",
    packageRoot,
    npmPackage: packageJson.name,
    npmVersion: packageJson.version,
    packagedRelease: packageJson.hermesAgent?.upstreamGitTag || null,
    packagedCommit,
    runtimeCommit,
    runtimeSourceDirectory: sourceDirectory,
    runtimeVenvDirectory: path.join(sourceDirectory, "venv"),
    runtimeBranch: branch || null,
    runtimeDirty: runtimeDirtyPaths === null ? null : runtimeDirtyPaths.length > 0,
    runtimeDirtyPaths,
    runtimeReady,
    runtimeChannel: releasePinned ? "npm-release" : runtimeReady ? "upstream-native" : "missing",
    runtimeModifiedByNativeUpdate: runtimeReady ? !releasePinned : null,
    nativeUpdateCommand: "hermes update",
    nativeCheckCommand: "hermes update --check",
    releaseUpdateCommand: getReleaseUpdateCommand(),
    releaseCheckCommand: "hermes-npm check",
    installMethodsCommand: "hermes-npm methods --json",
    hermesHome,
    upstreamHandoffTarget: path.join(hermesHome, "hermes-agent"),
    installScope: context.isGlobal ? "global" : "local"
  };
}

async function fetchLatestNpmVersion() {
  const encodedName = canonicalPackageName.startsWith("@")
    ? `@${encodeURIComponent(canonicalPackageName.slice(1))}`
    : encodeURIComponent(canonicalPackageName);
  const response = await fetch(`${npmRegistry}/${encodedName}`, {
    headers: {
      Accept: "application/vnd.npm.install-v1+json",
      "User-Agent": "hermes-agent-npm"
    },
    signal: AbortSignal.timeout(30_000)
  });
  if (!response.ok) {
    throw new Error(`npm registry returned HTTP ${response.status} ${response.statusText}`);
  }
  const metadata = await response.json();
  const latest = metadata["dist-tags"]?.latest;
  if (!latest) throw new Error("npm registry response does not contain the latest dist-tag");
  return latest;
}

function printStatus(status) {
  console.log(`npm package:       ${status.npmPackage}@${status.npmVersion} (${status.installScope})`);
  console.log(`packaged release:  ${status.packagedRelease} (${status.packagedCommit || "unknown"})`);
  console.log(`runtime commit:    ${status.runtimeCommit || "not installed"}`);
  console.log(`runtime source:    ${status.runtimeSourceDirectory}`);
  console.log(`HERMES_HOME:       ${status.hermesHome}`);
  console.log(`runtime channel:   ${status.runtimeChannel}`);
  console.log(`native update:     ${status.nativeUpdateCommand}`);
  console.log(`release update:    ${status.releaseUpdateCommand}`);
  if (status.runtimeModifiedByNativeUpdate) {
    console.log("note: npm reinstall/update will return the runtime to the latest release-pinned build.");
  }
}

function getInstallMethods() {
  return {
    recommendedForNpmUsers: "npm-isolated",
    methods: [
      {
        id: "npm-isolated",
        install: "npm install --global hermes-agent",
        projectInstall: "npm install hermes-agent",
        commands: "hermes, hermes-agent, hermes-npm",
        sourceLocation: "inside the installed npm package",
        updateOwner: "hermes update (rolling) or hermes-npm update (npm Release)",
        uninstall: "npm uninstall --global hermes-agent",
        projectUninstall: "npm uninstall hermes-agent"
      },
      {
        id: "upstream-managed",
        install: "official upstream installer",
        officialDocs: "https://github.com/NousResearch/hermes-agent#quick-install",
        posixInstall: "curl -fsSL https://hermes-agent.nousresearch.com/install.sh | bash",
        windowsInstall: "iex (irm https://hermes-agent.nousresearch.com/install.ps1)",
        commands: "hermes, hermes-agent",
        sourceLocation: "$HERMES_HOME/hermes-agent (user-scoped handoff target)",
        updateOwner: "hermes update",
        uninstall: "hermes uninstall",
        migrateFromNpm: "hermes-npm migrate upstream --yes"
      },
      {
        id: "manual-development",
        install: "follow the upstream contributing guide",
        officialDocs: "https://hermes-agent.nousresearch.com/docs/developer-guide/contributing",
        commands: "checkout/venv entrypoints",
        sourceLocation: "developer-selected checkout with an external venv",
        updateOwner: "developer-managed Git and uv",
        uninstall: "remove the selected checkout and external venv",
        intendedFor: "contributors and CI, not ordinary npm users"
      }
    ]
  };
}

function printMethods() {
  console.log(`Hermes Agent installation methods

  npm-isolated (recommended when npm should own the deployment)
    global:     npm install --global hermes-agent
    project:    npm install hermes-agent
    update:     hermes update (rolling) or hermes-npm update (npm Release)
    uninstall:  matching global/project npm uninstall

  upstream-managed (official source layout and native ownership)
    handoff:    hermes-npm migrate upstream        # show the plan
                hermes-npm migrate upstream --yes  # install, verify, remove npm package
    direct:     https://github.com/NousResearch/hermes-agent#quick-install
    update:     hermes update
    uninstall:  hermes uninstall

  manual-development
    follow upstream's contributing guide; Git and uv own the checkout/venv.

Do not run 'hermes uninstall' while npm owns the runtime. It can remove the
package-local checkout without uninstalling the npm package.`);
}

function printHelp(topic) {
  if (topic === "install" || topic === "methods") {
    printMethods();
    return;
  }
  if (topic === "update") {
    console.log(`Update commands

  hermes update --check  Check the upstream native rolling channel
  hermes update          Update the live checkout from upstream
  hermes-npm check       Check the npm Release channel
  hermes-npm update      Install/reset to the checked npm Release

Native rolling changes are replaced by the next npm Release update.`);
    return;
  }
  if (topic === "migrate") {
    console.log(`Upstream handoff

  hermes-npm migrate upstream
      Print the exact target, installer, and npm removal plan. No changes.

  hermes-npm migrate upstream --yes
      Run the pinned official installer non-interactively, verify its exact
      Release commit and venv command, uninstall this npm package, then re-run
      the official PATH stage so command ownership is unambiguous.

The handoff uses the existing HERMES_HOME (or its platform default), preserves
user data, and transfers command/update ownership to upstream. It is one-way;
the bridge does not keep two competing 'hermes' commands active.`);
    return;
  }
  if (topic === "uninstall") {
    console.log(`Uninstall ownership

  npm deployment:       npm uninstall --global hermes-agent
  project dependency:   npm uninstall hermes-agent
  upstream deployment:  hermes uninstall

Do not use upstream 'hermes uninstall' while npm owns the runtime.`);
    return;
  }
  console.log(`Usage: hermes-npm <command> [options]

Commands:
  status [--json]   Show the npm release and live upstream runtime state
  check [--json]    Check the npm registry release channel
  update            Update through npm and return to the release channel
  methods [--json]  List supported installation and ownership models
  migrate upstream  Show a one-way handoff plan; add --yes to execute it
  help [topic]       Show help (install, update, migrate, uninstall)

The native rolling channel remains available through 'hermes update'.
Run 'hermes-npm help install' before choosing a deployment model.`);
}

function printMigrationPlan(plan) {
  console.log(`Upstream handoff plan (no changes made)

  npm package:        ${plan.npmPackage}@${plan.npmVersion} (${plan.installScope})
  upstream release:   ${plan.upstreamRelease} (${plan.upstreamCommit})
  HERMES_HOME:        ${plan.hermesHome}
  official checkout:  ${plan.installDirectory}
  npm-managed source: ${plan.npmManagedInstall ? "yes" : "no (execution will be refused)"}
  final owner:        upstream 'hermes update'

Execution will run the pinned upstream installer with setup/gateway prompts
disabled, verify the exact commit and venv command, and only then run:
  npm ${plan.npmUninstall.args.join(" ")}

It finishes by re-running the official installer's PATH stage from the verified
external checkout, after npm has removed its own shims.

User configuration and state under HERMES_HOME are preserved. Stop gateways,
agents, and Desktop first. Re-run with '--yes' to execute this one-way handoff.`);
}

function applyReleaseUpdate(version) {
  const context = detectInstallContext();
  assertReleaseUpdateAllowed(version, context);
  const args = getReleaseUpdateArgs(version, context);
  const child = spawn(npmCommand(), args, {
    cwd: context.projectRoot || process.cwd(),
    stdio: "inherit",
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
    console.error(`Failed to start npm: ${error.message}`);
    process.exit(1);
  });
}

function resetCurrentRelease() {
  const child = spawn(process.execPath, [path.join(packageRoot, "scripts", "postinstall.js"), "--force-release"], {
    cwd: packageRoot,
    stdio: "inherit",
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
    console.error(`Failed to reset the npm release runtime: ${error.message}`);
    process.exit(1);
  });
}

async function runNpmChannel(args) {
  const command = args[0] || "status";
  const json = args.includes("--json");

  if (command === "help" || command === "--help" || command === "-h") {
    printHelp(args[1]);
    return;
  }
  if (command === "methods") {
    const methods = getInstallMethods();
    if (json) console.log(JSON.stringify(methods, null, 2));
    else printMethods();
    return;
  }
  if (command === "migrate") {
    if (args[1] !== "upstream") {
      console.error("Only 'hermes-npm migrate upstream' is supported.");
      printHelp("migrate");
      process.exitCode = 2;
      return;
    }
    const unsupported = args.slice(2).filter((arg) => !["--yes", "--json"].includes(arg));
    if (unsupported.length > 0) {
      console.error(`Unknown migration option: ${unsupported[0]}`);
      process.exitCode = 2;
      return;
    }
    const plan = createUpstreamMigrationPlan(detectInstallContext());
    if (!args.includes("--yes")) {
      if (json) console.log(JSON.stringify(plan, null, 2));
      else printMigrationPlan(plan);
      return;
    }
    if (json) {
      console.error("--json cannot be combined with --yes because execution streams installer output.");
      process.exitCode = 2;
      return;
    }
    try {
      console.log(`Preparing the upstream handoff to ${plan.installDirectory}...`);
      await executeUpstreamMigration(plan, {
        runtimeStatus: readRuntimeStatus(),
        runGit
      });
      console.log("Upstream handoff completed. Open a new terminal and run 'hermes --version'.");
    } catch (error) {
      console.error(`Unable to complete the upstream handoff: ${error.message}`);
      console.error("The npm package is kept unless the final npm uninstall had already started.");
      process.exitCode = 1;
    }
    return;
  }
  if (command === "status") {
    const status = readRuntimeStatus();
    if (json) console.log(JSON.stringify(status, null, 2));
    else printStatus(status);
    return;
  }
  if (command === "check") {
    try {
      const latestVersion = await fetchLatestNpmVersion();
      const comparison = compareSemver(latestVersion, packageJson.version);
      const result = {
        ...readRuntimeStatus(),
        latestNpmVersion: latestVersion,
        releaseUpdateAvailable: comparison > 0,
        localPackageAheadOfRegistry: comparison < 0
      };
      if (json) console.log(JSON.stringify(result, null, 2));
      else {
        printStatus(result);
        console.log(`latest npm:        ${latestVersion}`);
        if (result.releaseUpdateAvailable) console.log("release update available");
        else if (result.localPackageAheadOfRegistry) console.log("local package version is newer than the npm latest dist-tag");
        else console.log("npm release channel is up to date");
      }
    } catch (error) {
      console.error(`Unable to check the npm release channel: ${error.message}`);
      process.exitCode = 1;
    }
    return;
  }
  if (command === "update") {
    try {
      const latestVersion = await fetchLatestNpmVersion();
      if (compareSemver(latestVersion, packageJson.version) < 0) {
        throw new Error(`npm latest is ${latestVersion}, older than the installed ${packageJson.version}; refusing to downgrade`);
      }
      const comparison = compareSemver(latestVersion, packageJson.version);
      if (comparison > 0) {
        applyReleaseUpdate(latestVersion);
      } else {
        const status = readRuntimeStatus();
        if (status.runtimeChannel === "npm-release") {
          console.log(`The npm release channel is already at ${packageJson.version}.`);
        } else {
          resetCurrentRelease();
        }
      }
    } catch (error) {
      console.error(`Unable to update through the npm release channel: ${error.message}`);
      process.exitCode = 1;
    }
    return;
  }

  console.error(`Unknown hermes-npm command: ${command}`);
  printHelp();
  process.exitCode = 2;
}

module.exports = {
  assertReleaseUpdateAllowed,
  detectInstallContext,
  compareSemver,
  fetchLatestNpmVersion,
  findNodeModulesOwner,
  getAliasMigrationCommands,
  getInstallMethods,
  getReleaseUpdateArgs,
  getReleaseUpdateCommand,
  isReleasePinned,
  parseGitStatusPorcelain,
  pathsReferToSameInstallLocation,
  printHelp,
  readRuntimeStatus,
  runNpmChannel
};
