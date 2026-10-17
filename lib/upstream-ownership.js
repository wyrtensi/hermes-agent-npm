const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

// A native 'hermes update' hands the package-local checkout to upstream's
// package manager (PM). PM records the dependency environment it built under
// '<root>/installs/<key>' and writes an untracked 'install-stamp.json' with
// 'updateMechanism: "self"' into the checkout; from then on upstream selects
// that environment at startup instead of the package's own venv. This module
// locates that state exactly as upstream does, so 'hermes-npm status' can
// report it and the installer can hand the checkout back to npm.

const INSTALL_STAMP_FILE = "install-stamp.json";
const INSTALL_KEY_PATTERN = /^[0-9a-f]{16}$/u;

function platformPath(platform = process.platform) {
  return platform === "win32" ? path.win32 : path.posix;
}

function lookupEnv(env, name, platform) {
  if (platform !== "win32") return env[name];
  const key = Object.keys(env).find((candidate) => candidate.toUpperCase() === name.toUpperCase());
  return key === undefined ? undefined : env[key];
}

// os.path.expandvars: '$name' and '${name}' everywhere, '%name%' on Windows.
// Unknown variables are left unchanged.
function expandVars(value, env, platform) {
  let expanded = value.replace(/\$(?:\{([^}]+)\}|(\w+))/gu, (match, braced, bare) => {
    const replacement = lookupEnv(env, braced || bare, platform);
    return replacement === undefined ? match : replacement;
  });
  if (platform === "win32") {
    expanded = expanded.replace(/%([^%]+)%/gu, (match, name) => {
      const replacement = lookupEnv(env, name, platform);
      return replacement === undefined ? match : replacement;
    });
  }
  return expanded;
}

// os.path.expanduser for the current user ('~' and '~/...'). '~user' forms
// are left unchanged.
function expandUser(value, env, platform, home) {
  const paths = platformPath(platform);
  const separators = platform === "win32" ? ["/", "\\"] : ["/"];
  if (value !== "~" && !(value.startsWith("~") && separators.includes(value[1]))) return value;
  const userHome = platform === "win32"
    ? lookupEnv(env, "USERPROFILE", platform) || home
    : env.HOME || home;
  return value === "~" ? userHome : paths.join(userHome, value.slice(2));
}

// hermes_constants._expand_hermes_home
function expandHermesHome(value, env, platform, home) {
  return expandUser(expandVars(value, env, platform), env, platform, home);
}

// Path.resolve(strict=False): the real path of the longest existing prefix,
// with the remaining components appended.
function resolveLikePython(target, platform = process.platform) {
  const paths = platformPath(platform);
  const absolute = paths.resolve(target);
  try {
    return fs.realpathSync.native(absolute);
  } catch {
    const parent = paths.dirname(absolute);
    if (parent === absolute) return absolute;
    return paths.join(resolveLikePython(parent, platform), paths.basename(absolute));
  }
}

function isSameOrInside(parent, candidate, platform) {
  const paths = platformPath(platform);
  const normalize = (value) => (platform === "win32" ? value.toLowerCase() : value);
  const relative = paths.relative(normalize(parent), normalize(candidate));
  if (relative === "") return true;
  return !(relative === ".." || relative.startsWith(`..${paths.sep}`) || paths.isAbsolute(relative));
}

// hermes_constants._get_platform_default_hermes_home
function getPlatformDefaultHermesHome(platform = process.platform, env = process.env, home = os.homedir()) {
  const paths = platformPath(platform);
  const suffix = env.HERMES_DATA_DIR_SUFFIX || "";
  if (platform === "win32") {
    const localAppData = (lookupEnv(env, "LOCALAPPDATA", platform) || "").trim();
    const base = localAppData || paths.join(home, "AppData", "Local");
    return paths.join(base, `hermes${suffix}`);
  }
  return paths.join(home, `.hermes${suffix}`);
}

// hermes_constants.get_default_hermes_root: the platform default home, unless
// HERMES_HOME resolves outside it. Then it is HERMES_HOME itself, or its
// grandparent when HERMES_HOME is '<root>/profiles/<name>'.
function getDefaultHermesRoot(options = {}) {
  const platform = options.platform || process.platform;
  const env = options.env || process.env;
  const home = options.home || os.homedir();
  const paths = platformPath(platform);
  const nativeHome = getPlatformDefaultHermesHome(platform, env, home);
  const envHome = (env.HERMES_HOME || "").trim();
  if (!envHome) return nativeHome;
  const envPath = expandHermesHome(envHome, env, platform, home);
  if (isSameOrInside(resolveLikePython(nativeHome, platform), resolveLikePython(envPath, platform), platform)) {
    return nativeHome;
  }
  const absolute = paths.resolve(envPath);
  return paths.basename(paths.dirname(absolute)) === "profiles" ? paths.dirname(paths.dirname(absolute)) : absolute;
}

// pm.environments.install_key: the first 16 hex digits of the SHA-256 of the
// resolved checkout path.
function getInstallKey(checkoutDirectory, platform = process.platform) {
  const canonical = resolveLikePython(checkoutDirectory, platform);
  return crypto.createHash("sha256").update(canonical, "utf8").digest("hex").slice(0, 16);
}

function getUpstreamInstallState(checkoutDirectory, options = {}) {
  const platform = options.platform || process.platform;
  const paths = platformPath(platform);
  const hermesRoot = getDefaultHermesRoot(options);
  const installKey = getInstallKey(checkoutDirectory, platform);
  const directory = paths.join(hermesRoot, "installs", installKey);
  return {
    hermesRoot,
    installKey,
    directory,
    factsPath: paths.join(directory, "facts.json")
  };
}

// Upstream reads its records as 'utf-8-sig'.
function stripByteOrderMark(text) {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

function readFacts(factsPath) {
  let text;
  try {
    text = fs.readFileSync(factsPath, "utf8");
  } catch (error) {
    if (error.code === "ENOENT" || error.code === "ENOTDIR") return null;
    return { environment: null, error: `cannot read ${factsPath}: ${error.message}` };
  }
  try {
    const data = JSON.parse(stripByteOrderMark(text));
    const environment = data?.packages?.venv?.environment;
    return { environment: typeof environment === "string" ? environment : null, error: null };
  } catch (error) {
    return { environment: null, error: `invalid ${factsPath}: ${error.message}` };
  }
}

function readInstallStamp(checkoutDirectory, isTracked) {
  const stampPath = path.join(checkoutDirectory, INSTALL_STAMP_FILE);
  let data;
  try {
    data = JSON.parse(stripByteOrderMark(fs.readFileSync(stampPath, "utf8")));
  } catch (error) {
    if (error.code === "ENOENT" || error.code === "ENOTDIR") return null;
    data = null;
  }
  const updateMechanism = data && typeof data === "object" && typeof data.updateMechanism === "string"
    ? data.updateMechanism
    : null;
  return {
    path: stampPath,
    updateMechanism,
    tracked: isTracked ? isTracked(INSTALL_STAMP_FILE) : null
  };
}

// Who owns the dependency environment of the checkout: upstream's package
// manager when it has a record for this checkout, npm otherwise. A
// self-managed install stamp means upstream takes the checkout over on the
// next launch even without a record.
function readUpstreamOwnership(checkoutDirectory, options = {}) {
  const state = getUpstreamInstallState(checkoutDirectory, options);
  const facts = readFacts(state.factsPath);
  const installStamp = readInstallStamp(checkoutDirectory, options.isTracked);
  const selfManagedStamp = Boolean(
    installStamp && installStamp.updateMechanism === "self" && installStamp.tracked !== true
  );
  return {
    hermesRoot: state.hermesRoot,
    installKey: state.installKey,
    installStateDirectory: state.directory,
    factsPath: state.factsPath,
    dependenciesOwner: facts ? "upstream-pm" : "npm",
    dependencyEnvironment: facts ? facts.environment : null,
    factsError: facts ? facts.error : null,
    installStamp,
    selfManagedStamp
  };
}

function isSymbolicLink(target) {
  try {
    return fs.lstatSync(target).isSymbolicLink();
  } catch {
    return false;
  }
}

function removeEntry(target, description, result, log, warn) {
  let stats;
  try {
    stats = fs.lstatSync(target);
  } catch (error) {
    if (error.code === "ENOENT" || error.code === "ENOTDIR") return;
    result.failed.push(target);
    warn(`Unable to inspect ${description} ${target}: ${error.message}`);
    return;
  }
  try {
    fs.rmSync(target, { recursive: stats.isDirectory(), force: true });
    result.removed.push(target);
    log(`Removed ${description}: ${target}`);
  } catch (error) {
    result.failed.push(target);
    warn(`Unable to remove ${description} ${target}: ${error.message}`);
  }
}

// Hands the checkout's dependencies back to npm after the installer has put
// the checkout on the commit pinned by this package. Removes exactly
// '<root>/installs/<key>' for this checkout and the checkout's untracked
// install stamp; nothing else under HERMES_HOME. Never throws: a failure is
// reported, and 'hermes-npm status' keeps showing upstream ownership.
function reclaimNpmOwnership(checkoutDirectory, options = {}) {
  const log = options.log || console.log;
  const warn = options.warn || console.warn;
  const result = { removed: [], failed: [] };
  let state;
  try {
    state = getUpstreamInstallState(checkoutDirectory, options);
  } catch (error) {
    warn(`Unable to locate upstream dependency state for ${checkoutDirectory}: ${error.message}`);
    result.failed.push(checkoutDirectory);
    return result;
  }

  const stamp = readInstallStamp(checkoutDirectory, options.isTracked);
  // Only a stamp git confirms as untracked is removed; an unknown answer keeps it.
  if (stamp && stamp.tracked === false) {
    removeEntry(stamp.path, "upstream install stamp", result, log, warn);
  }

  const installsDirectory = path.join(state.hermesRoot, "installs");
  const expected = path.join(installsDirectory, state.installKey);
  if (!INSTALL_KEY_PATTERN.test(state.installKey) || state.directory !== expected) {
    warn(`Refusing to remove unexpected upstream dependency state path: ${state.directory}`);
    result.failed.push(state.directory);
    return result;
  }
  if (isSymbolicLink(installsDirectory) || isSymbolicLink(state.directory)) {
    warn(`Refusing to remove upstream dependency state through a symbolic link: ${state.directory}`);
    result.failed.push(state.directory);
    return result;
  }
  // facts.json first: it is the record that selects upstream's environment,
  // so once it is gone upstream falls back to the package's own venv even if
  // the rest of the directory cannot be removed.
  removeEntry(state.factsPath, "upstream dependency record", result, log, warn);
  removeEntry(state.directory, "upstream dependency state for this checkout", result, log, warn);
  return result;
}

module.exports = {
  INSTALL_STAMP_FILE,
  expandHermesHome,
  getDefaultHermesRoot,
  getInstallKey,
  getPlatformDefaultHermesHome,
  getUpstreamInstallState,
  readUpstreamOwnership,
  reclaimNpmOwnership,
  resolveLikePython
};
