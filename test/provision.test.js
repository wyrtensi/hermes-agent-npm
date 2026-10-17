const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  HELD_LOCK_ENV,
  STALE_LOCK_MS,
  acquireProvisionLock,
  getProvisionLockPath,
  holdProvisionLockForInstaller,
  provisionLockIsStale,
  provisionRuntime
} = require("../lib/provision");
const {
  applyReleaseUpdate,
  getNpmSpawnSpec,
  getUpdatedPackageRoot,
  runSetup
} = require("../lib/npm-channel");
const {
  countPostinstallRuns,
  createFakePackage,
  expectedFakeVersionOutput,
  runNode,
  writeFakePostinstall
} = require("./helpers/fake-package");

function tempDirectory(context) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "hermes-npm-lock-"));
  context.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return directory;
}

function deadPid() {
  return spawnSync(process.execPath, ["-e", ""], { windowsHide: true }).pid;
}

function writeLock(lockPath, lock) {
  fs.writeFileSync(lockPath, JSON.stringify(lock));
}

test("acquires the provisioning lock in the package root and releases it", (context) => {
  const root = tempDirectory(context);
  const lockPath = getProvisionLockPath(root);
  const lock = acquireProvisionLock(lockPath);
  assert.equal(lock.waited, false);
  assert.equal(JSON.parse(fs.readFileSync(lockPath, "utf8")).pid, process.pid);
  lock.release();
  assert.equal(fs.existsSync(lockPath), false);
});

test("waits for a lock held by a live process and gives up at the timeout", (context) => {
  const root = tempDirectory(context);
  const lockPath = getProvisionLockPath(root);
  const holder = { pid: process.pid, startedAt: new Date().toISOString() };
  writeLock(lockPath, holder);
  let waitedFor = null;
  assert.throws(
    () => acquireProvisionLock(lockPath, { timeoutMs: 300, pollMs: 50, onWait: (lock) => { waitedFor = lock; } }),
    /Timed out waiting for another Hermes Agent setup/
  );
  assert.deepEqual(waitedFor, holder);
  assert.deepEqual(JSON.parse(fs.readFileSync(lockPath, "utf8")), holder);
});

test("replaces a lock left by a process that no longer exists", (context) => {
  const root = tempDirectory(context);
  const lockPath = getProvisionLockPath(root);
  writeLock(lockPath, { pid: deadPid(), startedAt: new Date().toISOString() });
  const lock = acquireProvisionLock(lockPath, { timeoutMs: 1000, pollMs: 50 });
  assert.equal(JSON.parse(fs.readFileSync(lockPath, "utf8")).pid, process.pid);
  lock.release();
});

test("treats an expired lock as stale even when its PID is alive", (context) => {
  const root = tempDirectory(context);
  const lockPath = getProvisionLockPath(root);
  const now = Date.now();
  writeLock(lockPath, { pid: process.pid, startedAt: new Date(now - STALE_LOCK_MS - 1000).toISOString() });
  assert.equal(provisionLockIsStale(lockPath, now), true);
  writeLock(lockPath, { pid: process.pid, startedAt: new Date(now).toISOString() });
  assert.equal(provisionLockIsStale(lockPath, now), false);
});

test("keeps a lock with a live PID through a long installation", (context) => {
  const root = tempDirectory(context);
  const lockPath = getProvisionLockPath(root);
  const now = Date.now();
  writeLock(lockPath, { pid: process.pid, startedAt: new Date(now - 2 * 60 * 60 * 1000).toISOString() });
  assert.equal(provisionLockIsStale(lockPath, now), false);
});

test("an npm lifecycle installer takes the provisioning lock", (context) => {
  const root = tempDirectory(context);
  const lockPath = getProvisionLockPath(root);
  const lock = holdProvisionLockForInstaller(root, { env: {}, timeoutMs: 1000, pollMs: 50 });
  assert.equal(JSON.parse(fs.readFileSync(lockPath, "utf8")).pid, process.pid);
  lock.release();
  assert.equal(fs.existsSync(lockPath), false);
});

test("an installer spawned under the lock does not wait on its parent", (context) => {
  const root = tempDirectory(context);
  const lockPath = getProvisionLockPath(root);
  writeLock(lockPath, { pid: process.pid, startedAt: new Date().toISOString() });
  const lock = holdProvisionLockForInstaller(root, { env: { [HELD_LOCK_ENV]: lockPath }, timeoutMs: 100, pollMs: 10 });
  lock.release();
  assert.equal(fs.existsSync(lockPath), true);
});

test("provisionRuntime tells the installer which lock it holds", (context) => {
  const root = tempDirectory(context);
  let childEnv;
  const result = provisionRuntime({
    packageRoot: root,
    env: { KEEP: "1" },
    spawnSync: (command, args, options) => {
      childEnv = options.env;
      return { status: 0 };
    }
  });
  assert.equal(result.status, 0);
  assert.equal(childEnv.KEEP, "1");
  assert.equal(childEnv[HELD_LOCK_ENV], getProvisionLockPath(root));
});

test("keeps a freshly created lock that has not been written yet", (context) => {
  const root = tempDirectory(context);
  const lockPath = getProvisionLockPath(root);
  fs.writeFileSync(lockPath, "");
  assert.equal(provisionLockIsStale(lockPath), false);
});

test("skips the installer when the runtime became ready while waiting", (context) => {
  const root = tempDirectory(context);
  let spawned = false;
  const result = provisionRuntime({
    packageRoot: root,
    isReady: () => true,
    spawnSync: () => {
      spawned = true;
      return { status: 0 };
    }
  });
  assert.deepEqual(result, { status: 0, provisioned: false, waited: false });
  assert.equal(spawned, false);
  assert.equal(fs.existsSync(getProvisionLockPath(root)), false);
});

test("runs the package's own postinstall with the current Node.js", (context) => {
  const root = tempDirectory(context);
  let call = null;
  const result = provisionRuntime({
    packageRoot: root,
    stdio: "pipe",
    spawnSync: (command, args, options) => {
      call = { command, args, options };
      assert.equal(fs.existsSync(getProvisionLockPath(root)), true);
      return { status: 0 };
    }
  });
  assert.equal(result.status, 0);
  assert.equal(call.command, process.execPath);
  assert.deepEqual(call.args, [path.join(root, "scripts", "postinstall.js")]);
  assert.equal(call.options.cwd, root);
  assert.equal(fs.existsSync(getProvisionLockPath(root)), false);
});

test("reports a package root that cannot hold the lock instead of throwing", (context) => {
  const missingRoot = path.join(tempDirectory(context), "missing");
  const result = provisionRuntime({ packageRoot: missingRoot, spawnSync: () => assert.fail("must not spawn") });
  assert.equal(result.status, 1);
  assert.match(result.error, /ENOENT|no such file/i);
});

test("first launch provisions the missing runtime and keeps stdout clean", async (context) => {
  const { packageRoot } = createFakePackage(context);
  const first = await runNode(path.join(packageRoot, "bin", "hermes.js"), ["--version"]);
  assert.equal(first.status, 0, first.stderr);
  assert.equal(first.stdout.trim(), expectedFakeVersionOutput());
  assert.match(first.stderr, /one-time download, usually 1-2 minutes/);
  assert.match(first.stderr, /fake postinstall stdout/);
  assert.equal(countPostinstallRuns(packageRoot), 1);
  assert.equal(fs.existsSync(getProvisionLockPath(packageRoot)), false);

  const second = await runNode(path.join(packageRoot, "bin", "hermes.js"), ["--version"]);
  assert.equal(second.status, 0, second.stderr);
  assert.equal(second.stderr, "");
  assert.equal(countPostinstallRuns(packageRoot), 1);
});

test("concurrent first launches provision the runtime once", async (context) => {
  const { packageRoot } = createFakePackage(context);
  const env = { FAKE_POSTINSTALL_DELAY_MS: "1500" };
  const results = await Promise.all([
    runNode(path.join(packageRoot, "bin", "hermes.js"), ["--version"], { env }),
    runNode(path.join(packageRoot, "bin", "hermes.js"), ["--version"], { env }),
    runNode(path.join(packageRoot, "bin", "hermes.js"), ["--version"], { env })
  ]);
  for (const result of results) {
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout.trim(), expectedFakeVersionOutput());
  }
  assert.equal(countPostinstallRuns(packageRoot), 1);
  assert.equal(results.filter((result) => /one-time download/.test(result.stderr)).length, 1);
  assert.equal(results.filter((result) => /Waiting for another Hermes Agent setup/.test(result.stderr)).length, 2);
});

test("a failed first-launch setup exits non-zero and points to hermes-npm setup", async (context) => {
  const { packageRoot } = createFakePackage(context);
  const result = await runNode(path.join(packageRoot, "bin", "hermes.js"), ["--version"], {
    env: { FAKE_POSTINSTALL_EXIT: "3" }
  });
  assert.equal(result.status, 1);
  assert.equal(result.stdout, "");
  assert.match(result.stderr, /setup failed with exit code 3/);
  assert.match(result.stderr, /hermes-npm setup/);
  assert.equal(fs.existsSync(getProvisionLockPath(packageRoot)), false);
});

test("HERMES_NPM_AUTO_SETUP=0 keeps the explicit not-ready error", async (context) => {
  const { packageRoot } = createFakePackage(context);
  const result = await runNode(path.join(packageRoot, "bin", "hermes-agent.js"), [], {
    env: { HERMES_NPM_AUTO_SETUP: "0" }
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /isolated runtime is not ready/);
  assert.match(result.stderr, /hermes-npm setup/);
  assert.equal(countPostinstallRuns(packageRoot), 0);
});

for (const command of ["setup", "provision"]) {
  test(`hermes-npm ${command} runs the package installer`, async (context) => {
    const { packageRoot } = createFakePackage(context);
    const result = await runNode(path.join(packageRoot, "bin", "hermes-npm.js"), [command]);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /fake postinstall stdout/);
    assert.equal(countPostinstallRuns(packageRoot), 1);

    const repeat = await runNode(path.join(packageRoot, "bin", "hermes-npm.js"), [command]);
    assert.equal(repeat.status, 0, repeat.stderr);
    assert.equal(countPostinstallRuns(packageRoot), 2);
  });
}

test("hermes-npm setup propagates installer failure and rejects options", async (context) => {
  const { packageRoot } = createFakePackage(context);
  const failed = await runNode(path.join(packageRoot, "bin", "hermes-npm.js"), ["setup"], {
    env: { FAKE_POSTINSTALL_EXIT: "4" }
  });
  assert.equal(failed.status, 4);
  const unknown = await runNode(path.join(packageRoot, "bin", "hermes-npm.js"), ["setup", "--yes"]);
  assert.equal(unknown.status, 2);
  assert.match(unknown.stderr, /Unknown setup option: --yes/);
  assert.equal(countPostinstallRuns(packageRoot), 1);
});

test("same-version release reset goes through the locked installer", (context) => {
  quietConsole(context);
  let options = null;
  const status = runSetup({
    args: ["--force-release"],
    provisionRuntime: (received) => {
      options = received;
      return { status: 0, provisioned: true };
    }
  });
  assert.equal(status, 0);
  assert.deepEqual(options.args, ["--force-release"]);
  assert.equal(options.stdio, "inherit");
  assert.equal(runSetup({ provisionRuntime: () => ({ status: 1, error: "locked out" }) }), 1);
});

test("starts npm through cmd.exe on Windows and directly elsewhere", () => {
  assert.deepEqual(getNpmSpawnSpec(["root", "--global"], "linux"), { command: "npm", args: ["root", "--global"] });
  assert.deepEqual(getNpmSpawnSpec(["root", "--global"], "win32", { ComSpec: "C:\\Windows\\system32\\cmd.exe" }), {
    command: "C:\\Windows\\system32\\cmd.exe",
    args: ["/d", "/s", "/c", "npm", "root", "--global"]
  });
  assert.equal(getNpmSpawnSpec([], "win32", {}).command, "cmd.exe");
});

test("locates the package npm reinstalls for project and global scopes", () => {
  const project = path.join(path.parse(process.cwd()).root, "work", "project");
  assert.equal(
    getUpdatedPackageRoot({ isGlobal: false, projectRoot: project }),
    path.join(project, "node_modules", "hermes-agent")
  );
  assert.equal(
    path.basename(getUpdatedPackageRoot({ isGlobal: true, projectRoot: null })),
    "hermes-agent"
  );
});

function simulateNpmInstall(projectRoot, version, { runsPostinstall }) {
  const calls = [];
  const spawn = (command, args, options) => {
    calls.push({ command, args, options });
    const root = path.join(projectRoot, "node_modules", "hermes-agent");
    fs.rmSync(root, { recursive: true, force: true });
    fs.mkdirSync(root, { recursive: true });
    fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({
      name: "hermes-agent",
      version,
      hermesAgent: { runtimeDirectory: "runtime/hermes-agent" }
    }));
    writeFakePostinstall(root);
    if (runsPostinstall) {
      const result = spawnSync(process.execPath, [path.join(root, "scripts", "postinstall.js")], { windowsHide: true });
      assert.equal(result.status, 0, String(result.stderr));
    }
    return { status: 0 };
  };
  return { calls, spawn };
}

function quietConsole(context) {
  for (const method of ["log", "warn", "error"]) context.mock.method(console, method, () => {});
}

test("hermes-npm update provisions the new version when npm 12 skipped its install script", (context) => {
  quietConsole(context);
  const projectRoot = tempDirectory(context);
  const npm = simulateNpmInstall(projectRoot, "99.0.0", { runsPostinstall: false });
  const status = applyReleaseUpdate("99.0.0", {
    detectInstallContext: () => ({ isGlobal: false, projectRoot }),
    spawnSync: npm.spawn
  });
  const root = path.join(projectRoot, "node_modules", "hermes-agent");
  assert.equal(status, 0);
  assert.equal(npm.calls.length, 1);
  assert.equal(npm.calls[0].args.some((arg) => arg.includes("allow-scripts")), false);
  assert.ok(npm.calls[0].args.includes("hermes-agent@99.0.0"));
  assert.equal(npm.calls[0].options.cwd, projectRoot);
  assert.equal(countPostinstallRuns(root), 1);
  assert.equal(JSON.parse(fs.readFileSync(path.join(root, ".hermes-agent-runtime.json"), "utf8")).npmVersion, "99.0.0");
});

test("hermes-npm update leaves a runtime that npm already provisioned alone", (context) => {
  quietConsole(context);
  const projectRoot = tempDirectory(context);
  const npm = simulateNpmInstall(projectRoot, "99.0.0", { runsPostinstall: true });
  const status = applyReleaseUpdate("99.0.0", {
    detectInstallContext: () => ({ isGlobal: false, projectRoot }),
    spawnSync: npm.spawn
  });
  assert.equal(status, 0);
  assert.equal(countPostinstallRuns(path.join(projectRoot, "node_modules", "hermes-agent")), 1);
});

test("hermes-npm update reports npm and fallback failures", (context) => {
  quietConsole(context);
  const projectRoot = tempDirectory(context);
  const detect = () => ({ isGlobal: false, projectRoot });
  assert.equal(applyReleaseUpdate("99.0.0", { detectInstallContext: detect, spawnSync: () => ({ status: 5 }) }), 5);
  assert.equal(
    applyReleaseUpdate("99.0.0", { detectInstallContext: detect, spawnSync: () => ({ error: new Error("spawn EINVAL") }) }),
    1
  );

  const npm = simulateNpmInstall(projectRoot, "99.0.0", { runsPostinstall: false });
  const status = applyReleaseUpdate("99.0.0", {
    detectInstallContext: detect,
    spawnSync: npm.spawn,
    provisionRuntime: () => ({ status: 7, provisioned: true })
  });
  assert.equal(status, 7);
});
