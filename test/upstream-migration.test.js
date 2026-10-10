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
  getDefaultNastechHome,
  getNpmUninstallArgs,
  getUpstreamInstallerInvocation,
  getUpstreamPathInvocation,
  inspectExistingTarget,
  isPathInside,
  normalizeRepositoryUrl
} = require("../lib/upstream-migration");

test("uses platform-native default Nastech homes", () => {
  assert.equal(
    getDefaultNastechHome("linux", {}, "/home/example"),
    path.posix.resolve("/home/example/.nastech")
  );
  assert.equal(
    getDefaultNastechHome("darwin", { NASTECH_HOME: "/srv/nastech" }, "/Users/example"),
    path.posix.resolve("/srv/nastech")
  );
  assert.equal(
    getDefaultNastechHome("win32", { LOCALAPPDATA: "C:\\Users\\Example\\AppData\\Local" }, "C:\\Users\\Example"),
    path.win32.resolve("C:\\Users\\Example\\AppData\\Local", "nastech")
  );
});

test("builds a pinned non-interactive POSIX installer invocation", () => {
  const plan = {
    installerPath: "/npm/runtime/nastech-agent/scripts/install.sh",
    upstreamCommit: "a".repeat(40),
    installDirectory: "/home/example/.nastech/nastech-agent",
    nastechHome: "/home/example/.nastech"
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
      "--nastech-home", plan.nastechHome
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
  assert.deepEqual(plan.npmUninstall.args, ["uninstall", "--global", "nastech-agent"]);
  assert.equal(plan.finalizePath.command, "powershell.exe");
  assert.ok(plan.finalizePath.args.includes("-Stage"));
  assert.ok(plan.finalizePath.args.includes(plan.installerFinalizeStage));
});

test("defaults to the legacy path stage without release stage metadata", () => {
  const invocation = getUpstreamPathInvocation({
    installDirectory: "C:\\Users\\Example\\nastech-agent",
    nastechHome: "C:\\Users\\Example"
  }, "win32");
  assert.ok(invocation.args.includes("path"));
});

test("re-applies the official POSIX products stage after npm removal", () => {
  const plan = {
    installDirectory: "/home/example/.nastech/nastech-agent",
    nastechHome: "/home/example/.nastech",
    installerFinalizeStage: "products"
  };
  assert.deepEqual(getUpstreamPathInvocation(plan, "linux"), {
    command: "bash",
    args: [
      "/home/example/.nastech/nastech-agent/scripts/install.sh",
      "--stage", "products",
      "--non-interactive",
      "--dir", plan.installDirectory,
      "--nastech-home", plan.nastechHome
    ]
  });
});

test("keeps npm uninstall scope explicit", () => {
  assert.deepEqual(getNpmUninstallArgs({ isGlobal: false }), ["uninstall", "nastech-agent"]);
  assert.deepEqual(getNpmUninstallArgs({ isGlobal: true }), ["uninstall", "--global", "nastech-agent"]);
});

test("refuses migration execution outside an installed node_modules package", () => {
  assert.throws(
    () => assertMigrationPreconditions(
      {
        npmManagedInstall: false,
        platform: process.platform,
        installerPath: __filename,
        nastechHome: path.dirname(__dirname),
        installDirectory: path.join(path.dirname(__dirname), "unused")
      },
      { runtimeChannel: "npm-release" },
      () => null
    ),
    /not running from an npm-managed node_modules installation/
  );
});

test("verifies the official target before starting npm removal", async () => {
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "nastech-migration-test-"));
  const installDirectory = path.join(temporaryRoot, "nastech-agent");
  const consoleExecutable = path.join(installDirectory, "venv", "bin", "nastech");
  const commit = "b".repeat(40);
  const calls = [];
  const plan = {
    npmManagedInstall: true,
    platform: "linux",
    installerPath: __filename,
    nastechHome: temporaryRoot,
    installDirectory,
    consoleExecutable,
    upstreamCommit: commit,
    installer: { command: "bash", args: [__filename] },
    npmUninstall: { command: "npm", args: ["uninstall", "nastech-agent"] },
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
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "nastech-origin-test-"));
  const installDirectory = path.join(temporaryRoot, "nastech-agent");
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
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "nastech-dirty-test-"));
  const installDirectory = path.join(temporaryRoot, "nastech-agent");
  fs.mkdirSync(path.join(installDirectory, ".git"), { recursive: true });
  try {
    assert.throws(
      () => inspectExistingTarget(
        { installDirectory },
        (args) => args.includes("remote")
          ? "https://github.com/NastechResearch/nastech-agent.git"
          : " M scripts/install.sh"
      ),
      /dirty upstream checkout/
    );
  } finally {
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
});

test("does not remove npm when post-install verification fails", async () => {
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "nastech-verification-test-"));
  const installDirectory = path.join(temporaryRoot, "nastech-agent");
  const calls = [];
  const plan = {
    npmManagedInstall: true,
    platform: "linux",
    installerPath: __filename,
    nastechHome: temporaryRoot,
    installDirectory,
    consoleExecutable: path.join(installDirectory, "venv", "bin", "nastech"),
    upstreamCommit: "c".repeat(40),
    installer: { command: "bash", args: [__filename] },
    npmUninstall: { command: "npm", args: ["uninstall", "nastech-agent"] },
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
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "nastech-uninstall-test-"));
  const installDirectory = path.join(temporaryRoot, "nastech-agent");
  const consoleExecutable = path.join(installDirectory, "venv", "bin", "nastech");
  const calls = [];
  const plan = {
    npmManagedInstall: true,
    platform: "linux",
    installerPath: __filename,
    nastechHome: temporaryRoot,
    installDirectory,
    consoleExecutable,
    upstreamCommit: "d".repeat(40),
    installer: { command: "bash", args: [__filename] },
    npmUninstall: { command: "npm", args: ["uninstall", "nastech-agent"] },
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

test("canonical containment catches a symlinked Nastech home", { skip: process.platform === "win32" }, () => {
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "nastech-symlink-test-"));
  const linkedHome = path.join(temporaryRoot, "linked-home");
  fs.symlinkSync(path.resolve(__dirname, ".."), linkedHome, "dir");
  try {
    assert.throws(
      () => assertMigrationPreconditions(
        {
          npmManagedInstall: true,
          platform: process.platform,
          installerPath: __filename,
          nastechHome: linkedHome,
          installDirectory: path.join(linkedHome, "nastech-agent")
        },
        { runtimeChannel: "npm-release" },
        () => null
      ),
      /NASTECH_HOME or its install target resolves inside the npm package/
    );
  } finally {
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
});

test("canonical containment catches a symlinked install target", { skip: process.platform === "win32" }, () => {
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "nastech-target-symlink-test-"));
  const linkedTarget = path.join(temporaryRoot, "nastech-agent");
  fs.symlinkSync(path.resolve(__dirname, ".."), linkedTarget, "dir");
  try {
    assert.throws(
      () => assertMigrationPreconditions(
        {
          npmManagedInstall: true,
          platform: process.platform,
          installerPath: __filename,
          nastechHome: temporaryRoot,
          installDirectory: linkedTarget
        },
        { runtimeChannel: "npm-release" },
        () => null
      ),
      /NASTECH_HOME or its install target resolves inside the npm package/
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
    normalizeRepositoryUrl("https://github.com/NastechResearch/nastech-agent.git/\n"),
    "https://github.com/NastechResearch/nastech-agent.git"
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
