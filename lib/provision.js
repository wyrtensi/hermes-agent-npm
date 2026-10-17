const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const LOCK_FILE_NAME = ".hermes-agent-provision.lock";
// Names the lock a parent already holds for the installer it spawned, so the
// child does not wait on its own parent.
const HELD_LOCK_ENV = "HERMES_NPM_PROVISION_LOCK";
// A lock whose PID is alive is honored: provisioning on a slow network can take
// well over an hour. Only a lock this old is treated as left over from a crash
// whose PID has since been reused.
const STALE_LOCK_MS = 6 * 60 * 60 * 1000;
// A lock file that cannot be parsed is only treated as stale after this grace
// period, so a holder that has created but not yet written it keeps the lock.
const UNREADABLE_LOCK_GRACE_MS = 30 * 1000;
const DEFAULT_WAIT_TIMEOUT_MS = 45 * 60 * 1000;
const WAIT_POLL_MS = 500;

function sleepSync(milliseconds) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
}

function processIsAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === "EPERM";
  }
}

function getProvisionLockPath(packageRoot) {
  return path.join(packageRoot, LOCK_FILE_NAME);
}

function readProvisionLock(lockPath) {
  try {
    const lock = JSON.parse(fs.readFileSync(lockPath, "utf8"));
    return lock && typeof lock === "object" ? lock : null;
  } catch {
    return null;
  }
}

function provisionLockIsStale(lockPath, now = Date.now(), isAlive = processIsAlive) {
  let stats;
  try {
    stats = fs.statSync(lockPath);
  } catch {
    return false;
  }
  const lock = readProvisionLock(lockPath);
  if (!lock) return now - stats.mtimeMs > UNREADABLE_LOCK_GRACE_MS;
  const startedAt = Date.parse(lock.startedAt);
  if (Number.isFinite(startedAt) && now - startedAt > STALE_LOCK_MS) return true;
  return !isAlive(lock.pid);
}

function acquireProvisionLock(lockPath, options = {}) {
  const timeoutMs = options.timeoutMs ?? DEFAULT_WAIT_TIMEOUT_MS;
  const pollMs = options.pollMs ?? WAIT_POLL_MS;
  const deadline = Date.now() + timeoutMs;
  let waited = false;

  while (true) {
    try {
      const fd = fs.openSync(lockPath, "wx");
      try {
        fs.writeSync(fd, `${JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() })}\n`);
      } finally {
        fs.closeSync(fd);
      }
      return { waited, release: () => releaseProvisionLock(lockPath) };
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
    }

    if (provisionLockIsStale(lockPath)) {
      fs.rmSync(lockPath, { force: true });
      continue;
    }
    if (!waited) {
      waited = true;
      options.onWait?.(readProvisionLock(lockPath));
    }
    if (Date.now() >= deadline) {
      throw new Error(`Timed out waiting for another Hermes Agent setup to finish (lock: ${lockPath})`);
    }
    sleepSync(pollMs);
  }
}

function releaseProvisionLock(lockPath) {
  const lock = readProvisionLock(lockPath);
  if (lock && lock.pid !== process.pid) return;
  fs.rmSync(lockPath, { force: true });
}

// Called by scripts/postinstall.js. A lifecycle run from npm takes the lock so a
// concurrent first launch waits for it instead of starting a second installer;
// a run spawned by provisionRuntime already holds it through its parent.
function holdProvisionLockForInstaller(packageRoot, options = {}) {
  const lockPath = getProvisionLockPath(path.resolve(packageRoot));
  const env = options.env || process.env;
  if (env[HELD_LOCK_ENV] && path.resolve(env[HELD_LOCK_ENV]) === lockPath) {
    return { waited: false, release() {} };
  }
  return acquireProvisionLock(lockPath, options);
}

function describeLockError(error, packageRoot) {
  if (["EACCES", "EPERM", "EROFS"].includes(error.code)) {
    return `Cannot write to the npm package directory ${packageRoot}. ` +
      "Run 'hermes-npm setup' as the account that owns this npm installation " +
      "(for a root-owned global prefix, with the same privileges used for 'npm install --global').";
  }
  return error.message;
}

// Runs the package's own scripts/postinstall.js under a lock in the package
// root. npm 12 blocks dependency install scripts by default, so the launcher,
// 'hermes-npm setup' and 'hermes-npm update' call this directly instead of
// relying on the npm lifecycle.
function provisionRuntime(options) {
  const packageRoot = path.resolve(options.packageRoot);
  const postinstallScript = options.postinstallScript || path.join(packageRoot, "scripts", "postinstall.js");
  const lockPath = getProvisionLockPath(packageRoot);
  const spawn = options.spawnSync || spawnSync;

  let lock;
  try {
    lock = acquireProvisionLock(lockPath, {
      onWait: options.onWait,
      pollMs: options.pollMs,
      timeoutMs: options.timeoutMs
    });
  } catch (error) {
    return { status: 1, provisioned: false, error: describeLockError(error, packageRoot) };
  }

  try {
    if (options.isReady?.()) {
      return { status: 0, provisioned: false, waited: lock.waited };
    }
    options.onStart?.();
    const result = spawn(process.execPath, [postinstallScript, ...(options.args || [])], {
      cwd: packageRoot,
      env: { ...(options.env || process.env), [HELD_LOCK_ENV]: lockPath },
      stdio: options.stdio || "inherit",
      windowsHide: true
    });
    if (result.error) {
      return { status: 1, provisioned: true, error: `Unable to start the runtime installer: ${result.error.message}` };
    }
    if (result.signal) {
      return { status: 1, provisioned: true, error: `The runtime installer was stopped by ${result.signal}` };
    }
    return { status: result.status ?? 1, provisioned: true, waited: lock.waited };
  } finally {
    lock.release();
  }
}

module.exports = {
  HELD_LOCK_ENV,
  LOCK_FILE_NAME,
  STALE_LOCK_MS,
  acquireProvisionLock,
  getProvisionLockPath,
  holdProvisionLockForInstaller,
  processIsAlive,
  provisionLockIsStale,
  provisionRuntime,
  readProvisionLock,
  releaseProvisionLock
};
