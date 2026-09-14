#!/usr/bin/env node

const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const packageJson = require("../package.json");
const { getRelatedPackageNames } = require("../lib/package-metadata");
const { getRuntimeSourceDirectory, getVenvDirectory } = require("../lib/python-launcher");
const { configureRuntimeSparseCheckout } = require("../lib/runtime-checkout");
const { ensureUv, UV_VERSION } = require("../lib/uv-installer");

const packageName = packageJson.name;
const packageRoot = path.resolve(__dirname, "..");
const runtimeRoot = path.join(packageRoot, "runtime");
const sourceDirectory = getRuntimeSourceDirectory();
const venvDirectory = getVenvDirectory();
const managedPythonDirectory = path.join(runtimeRoot, "python");
const cacheDirectory = path.join(runtimeRoot, "cache");
const runtimeMarkerPath = path.join(packageRoot, ".hermes-agent-runtime.json");
const pythonVersion = packageJson.hermesAgent?.pythonVersion || "3.11";
const upstreamRepository = packageJson.hermesAgent?.upstreamRepository;
const upstreamTag = packageJson.hermesAgent?.upstreamGitTag;
const upstreamCommit = packageJson.hermesAgent?.upstreamCommit;
const forceRelease = process.argv.slice(2).includes("--force-release");

function assertRuntimePath(target) {
  const relative = path.relative(packageRoot, path.resolve(target));
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`Refusing to modify path outside the npm package runtime: ${target}`);
  }
}

function removeRuntimePath(target) {
  assertRuntimePath(target);
  fs.rmSync(target, { recursive: true, force: true });
}

function validateMetadata() {
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(upstreamRepository || "")) {
    throw new Error("package.json contains an invalid hermesAgent.upstreamRepository");
  }
  if (!/^v[A-Za-z0-9][A-Za-z0-9._-]*$/.test(upstreamTag || "")) {
    throw new Error("package.json contains an invalid hermesAgent.upstreamGitTag");
  }
  if (!/^[0-9a-f]{40}$/.test(upstreamCommit || "")) {
    throw new Error("package.json must pin hermesAgent.upstreamCommit to a full commit SHA");
  }
}

function cleanGitEnvironment() {
  const env = {
    ...process.env,
    GIT_TERMINAL_PROMPT: "0",
    GCM_INTERACTIVE: "Never"
  };
  delete env.GIT_DIR;
  delete env.GIT_WORK_TREE;
  delete env.GIT_INDEX_FILE;
  return env;
}

function run(command, args, options = {}) {
  const hasInput = options.input !== undefined;
  const result = spawnSync(command, args, {
    cwd: options.cwd || packageRoot,
    env: options.env || process.env,
    encoding: options.capture ? "utf8" : undefined,
    input: options.input,
    stdio: options.capture
      ? ["ignore", "pipe", "pipe"]
      : hasInput ? ["pipe", "inherit", "inherit"] : "inherit",
    windowsHide: true
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const detail = options.capture ? (result.stderr || result.stdout || "").trim() : "";
    throw new Error(`${command} ${args[0] || ""} failed with exit code ${result.status ?? "unknown"}${detail ? `: ${detail}` : ""}`);
  }
  return options.capture ? result.stdout.trim() : "";
}

function ensureGit() {
  try {
    return run("git", ["--version"], { capture: true, env: cleanGitEnvironment() });
  } catch {
    throw new Error(
      "Git is required for the native 'hermes update' channel. Install Git and run 'npm rebuild hermes-agent'."
    );
  }
}

function git(args, options = {}) {
  return run("git", args, { ...options, env: cleanGitEnvironment() });
}

function readMarker() {
  try {
    return JSON.parse(fs.readFileSync(runtimeMarkerPath, "utf8"));
  } catch {
    return null;
  }
}

function markerMatchesPackage(marker) {
  return Boolean(
    marker &&
      marker.npmPackage === packageName &&
      marker.npmVersion === packageJson.version &&
      marker.upstreamGitTag === upstreamTag &&
      marker.upstreamCommit === upstreamCommit &&
      marker.pythonVersion === pythonVersion &&
      marker.uvVersion === UV_VERSION &&
      marker.platform === process.platform &&
      marker.arch === process.arch
  );
}

function checkoutIsUsable() {
  if (!fs.existsSync(path.join(sourceDirectory, ".git"))) return false;
  try {
    const origin = git(["-C", sourceDirectory, "remote", "get-url", "origin"], { capture: true });
    const expectedHttps = `https://github.com/${upstreamRepository}.git`;
    return origin.replace(/\/$/u, "") === expectedHttps;
  } catch {
    return false;
  }
}

function checkoutIsClean() {
  try {
    return git(["-C", sourceDirectory, "status", "--porcelain", "--untracked-files=no"], { capture: true }) === "";
  } catch {
    return false;
  }
}

function fetchAndVerifyPinnedTag(targetDirectory) {
  const tagRef = `refs/tags/${upstreamTag}`;
  git(["-C", targetDirectory, "fetch", "--depth=1", "--no-recurse-submodules", "origin", `+${tagRef}:${tagRef}`]);
  const fetchedCommit = git(["-C", targetDirectory, "rev-parse", `${tagRef}^{commit}`], { capture: true });
  if (fetchedCommit !== upstreamCommit) {
    throw new Error(`Upstream tag ${upstreamTag} resolved to ${fetchedCommit}, expected ${upstreamCommit}`);
  }
}

function createPinnedCheckout(targetDirectory) {
  removeRuntimePath(targetDirectory);
  fs.mkdirSync(targetDirectory, { recursive: true });
  const origin = `https://github.com/${upstreamRepository}.git`;

  git(["-c", "core.longpaths=true", "init", targetDirectory]);
  git(["-C", targetDirectory, "config", "core.autocrlf", "false"]);
  git(["-C", targetDirectory, "config", "core.longpaths", "true"]);
  git(["-C", targetDirectory, "remote", "add", "origin", origin]);
  configureRuntimeSparseCheckout(targetDirectory, git);
  fetchAndVerifyPinnedTag(targetDirectory);

  git(["-C", targetDirectory, "checkout", "--detach", upstreamCommit]);
  git(["-C", targetDirectory, "config", "remote.origin.fetch", "+refs/heads/main:refs/remotes/origin/main"]);
}

function resetPinnedCheckoutInPlace() {
  const previousCommit = git(["-C", sourceDirectory, "rev-parse", "HEAD"], { capture: true });
  fetchAndVerifyPinnedTag(sourceDirectory);
  git(["-C", sourceDirectory, "reset", "--hard", upstreamCommit]);
  return {
    commit() {},
    rollback() {
      git(["-C", sourceDirectory, "reset", "--hard", previousCommit]);
    }
  };
}

function installPinnedCheckout() {
  const stageDirectory = path.join(runtimeRoot, `.hermes-agent-stage-${process.pid}`);
  const backupDirectory = path.join(runtimeRoot, `.hermes-agent-backup-${process.pid}`);
  removeRuntimePath(stageDirectory);
  removeRuntimePath(backupDirectory);
  createPinnedCheckout(stageDirectory);

  let backedUp = false;
  try {
    if (fs.existsSync(sourceDirectory)) {
      fs.renameSync(sourceDirectory, backupDirectory);
      backedUp = true;
    }
    fs.renameSync(stageDirectory, sourceDirectory);
  } catch (error) {
    if (backedUp && !fs.existsSync(sourceDirectory)) fs.renameSync(backupDirectory, sourceDirectory);
    throw new Error(`Unable to replace the Hermes runtime. Stop running Hermes processes and retry: ${error.message}`);
  } finally {
    removeRuntimePath(stageDirectory);
  }

  return {
    commit() {
      removeRuntimePath(backupDirectory);
    },
    rollback() {
      if (!backedUp || !fs.existsSync(backupDirectory)) return;
      removeRuntimePath(sourceDirectory);
      fs.renameSync(backupDirectory, sourceDirectory);
    }
  };
}

function uvBootstrapEnvironment() {
  const env = {
    ...process.env,
    UV_CACHE_DIR: cacheDirectory,
    UV_NO_CONFIG: "true",
    UV_PYTHON_INSTALL_BIN: "false",
    UV_PYTHON_INSTALL_DIR: managedPythonDirectory
  };
  delete env.PYTHONHOME;
  delete env.PYTHONPATH;
  delete env.UV_PROJECT_ENVIRONMENT;
  delete env.UV_PYTHON;
  delete env.VIRTUAL_ENV;
  return env;
}

function uvSyncEnvironment() {
  const env = uvBootstrapEnvironment();
  delete env.UV_NO_CONFIG;
  env.UV_PROJECT_ENVIRONMENT = venvDirectory;
  env.UV_PYTHON = process.platform === "win32"
    ? path.join(venvDirectory, "Scripts", "python.exe")
    : path.join(venvDirectory, "bin", "python");
  env.VIRTUAL_ENV = venvDirectory;
  return env;
}

function syncRuntime(uvExecutable) {
  const pythonExecutable = process.platform === "win32"
    ? path.join(venvDirectory, "Scripts", "python.exe")
    : path.join(venvDirectory, "bin", "python");

  if (!fs.existsSync(pythonExecutable)) {
    console.log(`Creating an isolated managed Python ${pythonVersion} environment...`);
    run(uvExecutable, ["venv", "--managed-python", "--python", pythonVersion, venvDirectory], {
      cwd: sourceDirectory,
      env: uvBootstrapEnvironment()
    });
  }

  console.log("Synchronizing the upstream lockfile into the isolated environment...");
  // --frozen installs exactly what the upstream uv.lock records (hashes included)
  // without re-validating it against pyproject.toml. That freshness check depends
  // on the uv version and can reject a Release lockfile that upstream CI accepts.
  run(uvExecutable, ["sync", "--frozen", "--extra", "all", "--no-dev"], {
    cwd: sourceDirectory,
    env: uvSyncEnvironment()
  });
}

function warnIfRelatedPackageInstalled() {
  const relatedPackages = getRelatedPackageNames(packageName);
  if (relatedPackages.length === 0) return;

  const command = process.env.npm_execpath
    ? { executable: process.execPath, args: [process.env.npm_execpath, "root", "--global"] }
    : { executable: process.platform === "win32" ? "npm.cmd" : "npm", args: ["root", "--global"] };
  const result = spawnSync(command.executable, command.args, {
    encoding: "utf8",
    windowsHide: true
  });
  if (result.status !== 0) return;

  for (const relatedPackage of relatedPackages) {
    if (fs.existsSync(path.join(result.stdout.trim(), relatedPackage, "package.json"))) {
      console.warn(`${relatedPackage} is already installed globally; installing both packages creates duplicate runtimes.`);
    }
  }
}

async function main() {
  validateMetadata();
  warnIfRelatedPackageInstalled();
  console.log(ensureGit());
  fs.mkdirSync(runtimeRoot, { recursive: true });

  const uvExecutable = await ensureUv(packageRoot);
  const marker = readMarker();
  const currentCheckoutMatchesPackage = markerMatchesPackage(marker) && checkoutIsUsable();
  const keepCurrentCheckout = !forceRelease && currentCheckoutMatchesPackage;
  const resetCurrentCheckout = forceRelease && currentCheckoutMatchesPackage && checkoutIsClean();
  let transaction = null;

  try {
    if (keepCurrentCheckout) {
      console.log("Keeping the existing checkout; native rolling updates are preserved for this npm version.");
    } else if (resetCurrentCheckout) {
      console.log("Resetting the clean runtime to the release commit pinned by this npm package...");
      transaction = resetPinnedCheckoutInPlace();
    } else {
      if (forceRelease) console.log("Resetting the runtime to the release commit pinned by this npm package...");
      console.log(`Preparing Hermes Agent ${upstreamTag} at ${upstreamCommit.slice(0, 12)}...`);
      transaction = installPinnedCheckout();
    }

    syncRuntime(uvExecutable);
    const runtimeCommit = git(["-C", sourceDirectory, "rev-parse", "HEAD"], { capture: true });
    const runtimeMarker = {
      npmPackage: packageName,
      npmVersion: packageJson.version,
      upstreamVersion: packageJson.hermesAgent.upstreamVersion,
      upstreamGitTag: upstreamTag,
      upstreamCommit,
      runtimeCommitAtInstall: runtimeCommit,
      pythonVersion,
      uvVersion: UV_VERSION,
      platform: process.platform,
      arch: process.arch,
      installedAt: new Date().toISOString(),
      nativeUpdateCommand: "hermes update",
      npmUpdateCommand: "hermes-npm update"
    };
    fs.writeFileSync(runtimeMarkerPath, `${JSON.stringify(runtimeMarker, null, 2)}\n`, "utf8");
    transaction?.commit();
    console.log("Hermes Agent npm runtime is ready.");
    console.log("Use 'hermes update' for upstream rolling updates or 'hermes-npm update' for npm releases.");
  } catch (error) {
    transaction?.rollback();
    throw new Error(`Failed to prepare the isolated Hermes Agent runtime: ${error.message}`);
  } finally {
    removeRuntimePath(cacheDirectory);
  }
}

main().catch((error) => {
  console.error(`Installation failed: ${error.message}`);
  process.exit(1);
});
