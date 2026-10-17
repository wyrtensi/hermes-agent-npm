const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  getDefaultHermesRoot,
  getInstallKey,
  getPlatformDefaultHermesHome,
  readUpstreamOwnership,
  resolveLikePython
} = require("../lib/upstream-ownership");

function tempDirectory(context) {
  const directory = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), "hermes-ownership-")));
  context.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return directory;
}

function rootFor(home, hermesHome, extraEnv = {}) {
  const env = { ...extraEnv };
  if (process.platform === "win32") env.LOCALAPPDATA = path.join(home, "AppData", "Local");
  if (hermesHome !== undefined) env.HERMES_HOME = hermesHome;
  return getDefaultHermesRoot({ env, home });
}

function nativeHome(home) {
  return process.platform === "win32" ? path.join(home, "AppData", "Local", "hermes") : path.join(home, ".hermes");
}

test("uses the platform default Hermes home without HERMES_HOME", () => {
  assert.equal(getPlatformDefaultHermesHome("linux", {}, "/home/user"), "/home/user/.hermes");
  assert.equal(getPlatformDefaultHermesHome("darwin", { HERMES_DATA_DIR_SUFFIX: "-dev" }, "/Users/user"), "/Users/user/.hermes-dev");
  assert.equal(
    getPlatformDefaultHermesHome("win32", { LOCALAPPDATA: "D:\\Local" }, "C:\\Users\\user"),
    "D:\\Local\\hermes"
  );
  assert.equal(
    getPlatformDefaultHermesHome("win32", { LOCALAPPDATA: "  " }, "C:\\Users\\user"),
    "C:\\Users\\user\\AppData\\Local\\hermes"
  );
});

test("keeps the platform default root for a HERMES_HOME inside it", (context) => {
  const home = tempDirectory(context);
  fs.mkdirSync(path.join(nativeHome(home), "profiles", "work"), { recursive: true });
  assert.equal(rootFor(home), nativeHome(home));
  assert.equal(rootFor(home, "   "), nativeHome(home));
  assert.equal(rootFor(home, nativeHome(home)), nativeHome(home));
  assert.equal(rootFor(home, path.join(nativeHome(home), "profiles", "work")), nativeHome(home));
  assert.equal(rootFor(home, path.join(nativeHome(home), "profiles", "not-created-yet")), nativeHome(home));
});

test("uses a HERMES_HOME outside the platform default as the root", (context) => {
  const home = tempDirectory(context);
  const custom = path.join(home, "srv", "hermes-home");
  assert.equal(rootFor(home, custom), custom);
});

test("uses the grandparent of a profile HERMES_HOME outside the platform default", (context) => {
  const home = tempDirectory(context);
  const customRoot = path.join(home, "srv", "hermes");
  assert.equal(rootFor(home, path.join(customRoot, "profiles", "work")), customRoot);
});

test("expands variables and the user home in HERMES_HOME", (context) => {
  const home = tempDirectory(context);
  const homeVariable = process.platform === "win32" ? "USERPROFILE" : "HOME";
  assert.equal(rootFor(home, "$HERMES_TEST_BASE/profiles/x", { HERMES_TEST_BASE: path.join(home, "base") }), path.join(home, "base"));
  assert.equal(rootFor(home, "${HERMES_TEST_BASE}", { HERMES_TEST_BASE: path.join(home, "base") }), path.join(home, "base"));
  assert.equal(rootFor(home, "~/custom", { [homeVariable]: home }), path.join(home, "custom"));
});

test("treats HERMES_HOME through a symlink to the default home as the default root", (context) => {
  const home = tempDirectory(context);
  fs.mkdirSync(nativeHome(home), { recursive: true });
  const link = path.join(home, "linked-home");
  try {
    fs.symlinkSync(nativeHome(home), link, "junction");
  } catch (error) {
    context.skip(`symlinks are unavailable: ${error.code}`);
    return;
  }
  assert.equal(rootFor(home, link), nativeHome(home));
});

test("derives the install key from the resolved checkout path", (context) => {
  const directory = tempDirectory(context);
  const checkout = path.join(directory, "runtime", "hermes-agent");
  fs.mkdirSync(checkout, { recursive: true });
  assert.match(getInstallKey(checkout), /^[0-9a-f]{16}$/u);
  assert.equal(getInstallKey(path.join(checkout, "..", "hermes-agent")), getInstallKey(checkout));
  assert.equal(resolveLikePython(path.join(checkout, "missing", "child")), path.join(checkout, "missing", "child"));
});

test("computes the same install key as upstream's Python implementation", (context) => {
  const probe = spawnSync("python", ["--version"], { encoding: "utf8" });
  if (probe.error || probe.status !== 0) {
    context.skip("Python is not available");
    return;
  }
  // os.tmpdir() is a symlink on macOS (/var -> /private/var) and an 8.3 short
  // path on some Windows runners; pass it unresolved so both sides resolve it.
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "hermes-ownership-"));
  context.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const checkout = path.join(base, "Runtime", "hermes-agent");
  fs.mkdirSync(checkout, { recursive: true });
  const script = [
    "import hashlib, sys",
    "from pathlib import Path",
    "print(hashlib.sha256(str(Path(sys.argv[1]).resolve()).encode('utf-8')).hexdigest()[:16])"
  ].join("\n");
  const result = spawnSync("python", ["-c", script, checkout], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(getInstallKey(checkout), result.stdout.trim());
});

function createOwnedCheckout(context, facts) {
  const home = tempDirectory(context);
  const hermesHome = path.join(home, "hermes-home");
  const checkout = path.join(home, "prefix", "hermes-agent", "runtime", "hermes-agent");
  fs.mkdirSync(checkout, { recursive: true });
  const options = { env: { HERMES_HOME: hermesHome, LOCALAPPDATA: path.join(home, "AppData", "Local") }, home };
  const stateDirectory = path.join(hermesHome, "installs", getInstallKey(checkout));
  if (facts !== undefined) {
    fs.mkdirSync(stateDirectory, { recursive: true });
    fs.writeFileSync(path.join(stateDirectory, "facts.json"), facts);
  }
  return { checkout, hermesHome, options, stateDirectory };
}

test("reports npm ownership when upstream has no record for the checkout", (context) => {
  const { checkout, hermesHome, options, stateDirectory } = createOwnedCheckout(context);
  const ownership = readUpstreamOwnership(checkout, options);
  assert.equal(ownership.hermesRoot, hermesHome);
  assert.equal(ownership.installStateDirectory, stateDirectory);
  assert.equal(ownership.dependenciesOwner, "npm");
  assert.equal(ownership.dependencyEnvironment, null);
  assert.equal(ownership.installStamp, null);
  assert.equal(ownership.selfManagedStamp, false);
});

test("reports the environment upstream's package manager selected", (context) => {
  const environment = "/home/user/.hermes/installs/key/environments/abc/venv";
  const { checkout, options } = createOwnedCheckout(
    context,
    `\uFEFF${JSON.stringify({ packages: { venv: { environment } }, schema: 1 })}`
  );
  const ownership = readUpstreamOwnership(checkout, options);
  assert.equal(ownership.dependenciesOwner, "upstream-pm");
  assert.equal(ownership.dependencyEnvironment, environment);
  assert.equal(ownership.factsError, null);
});

test("reports an unreadable upstream record instead of ignoring it", (context) => {
  const { checkout, options } = createOwnedCheckout(context, "{not json");
  const ownership = readUpstreamOwnership(checkout, options);
  assert.equal(ownership.dependenciesOwner, "upstream-pm");
  assert.equal(ownership.dependencyEnvironment, null);
  assert.match(ownership.factsError, /invalid .*facts\.json/u);
});

test("flags an untracked self-managed install stamp", (context) => {
  const { checkout, options } = createOwnedCheckout(context);
  fs.writeFileSync(path.join(checkout, "install-stamp.json"), JSON.stringify({ updateMechanism: "self" }));

  const untracked = readUpstreamOwnership(checkout, { ...options, isTracked: () => false });
  assert.equal(untracked.selfManagedStamp, true);
  assert.deepEqual(untracked.installStamp, {
    path: path.join(checkout, "install-stamp.json"),
    updateMechanism: "self",
    tracked: false
  });

  assert.equal(readUpstreamOwnership(checkout, { ...options, isTracked: () => true }).selfManagedStamp, false);

  fs.writeFileSync(path.join(checkout, "install-stamp.json"), JSON.stringify({ updateMechanism: "packaged" }));
  assert.equal(readUpstreamOwnership(checkout, { ...options, isTracked: () => false }).selfManagedStamp, false);
});
