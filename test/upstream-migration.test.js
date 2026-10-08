const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  assertMigrationPreconditions,
  createUpstreamMigrationPlan,
  executeUpstreamMigration,
  formatInvocation,
  getDefaultHermesHome,
  getNpmUninstallArgs,
  getUpstreamInstallerInvocation,
  getUpstreamPathInvocation,
  inspectExistingTarget,
  isPathInside,
  normalizeRepositoryUrl
} = require("../lib/upstream-migration");

test("uses platform-native default Hermes homes", () => {
  assert.equal(
    getDefaultHermesHome("linux", {}, "/home/example"),
    path.posix.resolve("/home/example/.hermes")
  );
  assert.equal(
    getDefaultHermesHome("darwin", { HERMES_HOME: "/srv/hermes" }, "/Users/example"),
    path.posix.resolve("/srv/hermes")
  );
  assert.equal(
    getDefaultHermesHome("win32", { LOCALAPPDATA: "C:\\Users\\Example\\AppData\\Local" }, "C:\\Users\\Example"),
    path.win32.resolve("C:\\Users\\Example\\AppData\\Local", "hermes")
  );
});

test("builds a pinned non-interactive POSIX installer invocation", () => {
  const plan = {
    installerPath: "/npm/runtime/hermes-agent/scripts/install.sh",
    upstreamCommit: "a".repeat(40),
    installDirectory: "/home/example/.hermes/hermes-agent",
    hermesHome: "/home/example/.hermes"
  };
  assert.deepEqual(getUpstreamInstallerInvocation(plan, "linux"), {
    command: "bash",
    args: [
      plan.installerPath,
      "--commit", plan.upstreamCommit,
      "--force-commit",
      "--skip-setup",
      "--non-interactive",
      "--dir", plan.installDirectory,
      "--hermes-home", plan.hermesHome
    ]
  });
});

test("builds a pinned non-interactive Windows installer invocation", () => {
  const plan = createUpstreamMigrationPlan(
    { isGlobal: true, projectRoot: null },
    {
      platform: "win32",
      env: { LOCALAPPDATA: "C:\\Users\\Example\\AppData\\Local" },
      home: "C:\\Users\\Example"
    }
  );
  assert.equal(plan.installer.command, "powershell.exe");
  assert.ok(plan.installer.args.includes("-Commit"));
  assert.ok(plan.installer.args.includes(plan.upstreamCommit));
  assert.ok(plan.installer.args.includes("-NonInteractive"));
  assert.ok(plan.installer.args.includes("-InstallDir"));
  assert.deepEqual(plan.npmUninstall.args, ["uninstall", "--global", "hermes-agent"]);
  assert.equal(plan.finalizePath.command, "powershell.exe");
  assert.ok(plan.finalizePath.args.includes("-Stage"));
  assert.ok(plan.finalizePath.args.includes("products"));
});

test("re-applies the official POSIX products stage after npm removal", () => {
  const plan = {
    installDirectory: "/home/example/.hermes/hermes-agent",
    hermesHome: "/home/example/.hermes"
  };
  assert.deepEqual(getUpstreamPathInvocation(plan, "linux"), {
    command: "bash",
    args: [
      "/home/example/.hermes/hermes-agent/scripts/install.sh",
      "--stage", "products",
      "--non-interactive",
      "--dir", plan.installDirectory,
      "--hermes-home", plan.hermesHome
    ]
  });
});

test("keeps npm uninstall scope explicit", () => {
  assert.deepEqual(getNpmUninstallArgs({ isGlobal: false }), ["uninstall", "hermes-agent"]);
  assert.deepEqual(getNpmUninstallArgs({ isGlobal: true }), ["uninstall", "--global", "hermes-agent"]);
});

test("refuses migration execution outside an installed node_modules package", () => {
  assert.throws(
    () => assertMigrationPreconditions(
      {
        npmManagedInstall: false,
        platform: process.platform,
        installerPath: __filename,
        hermesHome: path.dirname(__dirname),
        installDirectory: path.join(path.dirname(__dirname), "unused")
      },
      { runtimeChannel: "npm-release" },
      () => null
    ),
    /not running from an npm-managed node_modules installation/
  );
});

test("verifies the official target before starting npm removal", async () => {
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "hermes-migration-test-"));
  const installDirectory = path.join(temporaryRoot, "hermes-agent");
  const consoleExecutable = path.join(installDirectory, "venv", "bin", "hermes");
  const commit = "b".repeat(40);
  const calls = [];
  const plan = {
    npmManagedInstall: true,
    platform: "linux",
    installerPath: __filename,
    hermesHome: temporaryRoot,
    installDirectory,
    consoleExecutable,
    upstreamCommit: commit,
    installer: { command: "bash", args: [__filename] },
    npmUninstall: { command: "npm", args: ["uninstall", "hermes-agent"] },
    finalizePath: { command: "bash", args: ["--stage", "products"] },
    npmWorkingDirectory: temporaryRoot
  };

  try {
    await executeUpstreamMigration(plan, {
      runtimeStatus: { runtimeChannel: "npm-release" },
      runGit: (args) => args.includes("rev-parse") ? commit : args.includes("status") ? "" : null,
      spawnAndWait: async (command) => {
        calls.push(command);
        if (command === "bash") {
          fs.mkdirSync(path.dirname(consoleExecutable), { recursive: true });
          fs.writeFileSync(consoleExecutable, "test", "utf8");
        }
      }
    });
    assert.deepEqual(calls, ["bash", "npm", "bash"]);
  } finally {
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
});

test("refuses an existing checkout with an unexpected origin", () => {
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "hermes-origin-test-"));
  const installDirectory = path.join(temporaryRoot, "hermes-agent");
  fs.mkdirSync(path.join(installDirectory, ".git"), { recursive: true });
  try {
    assert.throws(
      () => inspectExistingTarget({ installDirectory }, () => "https://example.invalid/other.git"),
      /unexpected Git origin/
    );
  } finally {
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
});

test("refuses a dirty existing upstream checkout", () => {
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "hermes-dirty-test-"));
  const installDirectory = path.join(temporaryRoot, "hermes-agent");
  fs.mkdirSync(path.join(installDirectory, ".git"), { recursive: true });
  try {
    assert.throws(
      () => inspectExistingTarget(
        { installDirectory },
        (args) => args.includes("remote")
          ? "https://github.com/NousResearch/hermes-agent.git"
          : " M scripts/install.sh"
      ),
      /dirty upstream checkout/
    );
  } finally {
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
});

test("does not remove npm when post-install verification fails", async () => {
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "hermes-verification-test-"));
  const installDirectory = path.join(temporaryRoot, "hermes-agent");
  const calls = [];
  const plan = {
    npmManagedInstall: true,
    platform: "linux",
    installerPath: __filename,
    hermesHome: temporaryRoot,
    installDirectory,
    consoleExecutable: path.join(installDirectory, "venv", "bin", "hermes"),
    upstreamCommit: "c".repeat(40),
    installer: { command: "bash", args: [__filename] },
    npmUninstall: { command: "npm", args: ["uninstall", "hermes-agent"] },
    npmWorkingDirectory: temporaryRoot
  };

  try {
    await assert.rejects(
      executeUpstreamMigration(plan, {
        runtimeStatus: { runtimeChannel: "npm-release" },
        runGit: (args) => args.includes("rev-parse") ? plan.upstreamCommit : "",
        spawnAndWait: async (command) => { calls.push(command); }
      }),
      /could not be verified/
    );
    assert.deepEqual(calls, ["bash"]);
  } finally {
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
});

test("finalizes official command ownership even when npm removal reports failure", async () => {
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "hermes-uninstall-test-"));
  const installDirectory = path.join(temporaryRoot, "hermes-agent");
  const consoleExecutable = path.join(installDirectory, "venv", "bin", "hermes");
  const calls = [];
  const plan = {
    npmManagedInstall: true,
    platform: "linux",
    installerPath: __filename,
    hermesHome: temporaryRoot,
    installDirectory,
    consoleExecutable,
    upstreamCommit: "d".repeat(40),
    installer: { command: "bash", args: [__filename] },
    npmUninstall: { command: "npm", args: ["uninstall", "hermes-agent"] },
    finalizePath: { command: "bash", args: ["--stage", "products"] },
    npmWorkingDirectory: temporaryRoot
  };

  try {
    await assert.rejects(
      executeUpstreamMigration(plan, {
        runtimeStatus: { runtimeChannel: "npm-release" },
        runGit: (args) => args.includes("rev-parse") ? plan.upstreamCommit : "",
        spawnAndWait: async (command) => {
          calls.push(command);
          if (command === "bash" && calls.length === 1) {
            fs.mkdirSync(path.dirname(consoleExecutable), { recursive: true });
            fs.writeFileSync(consoleExecutable, "test", "utf8");
          }
          if (command === "npm") throw new Error("permission denied");
        }
      }),
      /npm removal failed/
    );
    assert.deepEqual(calls, ["bash", "npm", "bash"]);
  } finally {
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
});

test("canonical containment catches a symlinked Hermes home", { skip: process.platform === "win32" }, () => {
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "hermes-symlink-test-"));
  const linkedHome = path.join(temporaryRoot, "linked-home");
  fs.symlinkSync(path.resolve(__dirname, ".."), linkedHome, "dir");
  try {
    assert.throws(
      () => assertMigrationPreconditions(
        {
          npmManagedInstall: true,
          platform: process.platform,
          installerPath: __filename,
          hermesHome: linkedHome,
          installDirectory: path.join(linkedHome, "hermes-agent")
        },
        { runtimeChannel: "npm-release" },
        () => null
      ),
      /HERMES_HOME or its install target resolves inside the npm package/
    );
  } finally {
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
});

test("canonical containment catches a symlinked install target", { skip: process.platform === "win32" }, () => {
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "hermes-target-symlink-test-"));
  const linkedTarget = path.join(temporaryRoot, "hermes-agent");
  fs.symlinkSync(path.resolve(__dirname, ".."), linkedTarget, "dir");
  try {
    assert.throws(
      () => assertMigrationPreconditions(
        {
          npmManagedInstall: true,
          platform: process.platform,
          installerPath: __filename,
          hermesHome: temporaryRoot,
          installDirectory: linkedTarget
        },
        { runtimeChannel: "npm-release" },
        () => null
      ),
      /HERMES_HOME or its install target resolves inside the npm package/
    );
  } finally {
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
});

test("detects paths inside the npm-owned tree", () => {
  assert.equal(isPathInside("/tmp/package", "/tmp/package/runtime", "linux"), true);
  assert.equal(isPathInside("/tmp/package", "/tmp/package/..data", "linux"), true);
  assert.equal(isPathInside("/tmp/package", "/tmp/package-other", "linux"), false);
  assert.equal(isPathInside("C:\\Pkg", "C:\\pkg\\runtime", "win32"), true);
});

test("normalizes accepted repository URL punctuation", () => {
  assert.equal(
    normalizeRepositoryUrl("https://github.com/NousResearch/hermes-agent.git/\n"),
    "https://github.com/NousResearch/hermes-agent.git"
  );
});

test("formats hostile POSIX recovery paths as literal single-quoted arguments", () => {
  const value = "/tmp/a b/O'Brien/$(touch nope);`id`";
  assert.equal(
    formatInvocation({ command: "bash", args: ["--file", value] }, "linux"),
    `'bash' '--file' '/tmp/a b/O'"'"'Brien/$(touch nope);\`id\`'`
  );
});

test("formats hostile PowerShell recovery paths as literal single-quoted arguments", () => {
  const value = "C:\\Users\\O'Brien\\$();`name with space";
  assert.equal(
    formatInvocation({ command: "powershell.exe", args: ["-File", value] }, "win32"),
    "& 'powershell.exe' '-File' 'C:\\Users\\O''Brien\\$();`name with space'"
  );
});

test("POSIX recovery quoting preserves the exact argument", { skip: process.platform === "win32" }, () => {
  const value = "/tmp/a b/O'Brien/$(touch nope);`id`";
  const command = formatInvocation({
    command: process.execPath,
    args: ["-e", "process.stdout.write(process.argv[1])", value]
  }, "linux");
  const result = spawnSync("sh", ["-c", command], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, value);
});

test("PowerShell recovery quoting preserves the exact argument", { skip: process.platform !== "win32" }, () => {
  const value = "C:\\Users\\O'Brien\\$();`name with space";
  const command = formatInvocation({
    command: process.execPath,
    args: ["-e", "process.stdout.write(process.argv[1])", value]
  }, "win32");
  const result = spawnSync("powershell.exe", ["-NoProfile", "-Command", command], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, value);
});
