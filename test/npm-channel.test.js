const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");

const {
  assertReleaseUpdateAllowed,
  compareSemver,
  fetchLatestNpmVersion,
  findNodeModulesOwner,
  getAliasMigrationCommands,
  getInstallMethods,
  getReleaseUpdateArgs,
  getReleaseUpdateCommand,
  isReleasePinned,
  parseGitStatusPorcelain,
  pathsReferToSameInstallLocation
} = require("../lib/npm-channel");

test("finds the project owning a regular node_modules directory", () => {
  const root = path.parse(process.cwd()).root;
  const project = path.join(root, "work", "example");
  const packagePath = path.join(project, "node_modules", "nastech-agent");
  assert.equal(findNodeModulesOwner(packagePath), project);
});

test("compares release and prerelease npm versions", () => {
  assert.equal(compareSemver("0.20.0", "0.15.2"), 1);
  assert.equal(compareSemver("0.20.0", "0.20.0"), 0);
  assert.equal(compareSemver("0.20.0-beta.2", "0.20.0-beta.1"), 1);
  assert.equal(compareSemver("0.20.0", "0.20.0-beta.2"), 1);
});

test("routes release updates through the checked npm channel", () => {
  assert.equal(getReleaseUpdateCommand(), "nastech-npm update");
});

test("describes all supported installation ownership models", () => {
  const methods = getInstallMethods();
  assert.equal(methods.recommendedForNpmUsers, "npm-isolated");
  assert.deepEqual(methods.methods.map((method) => method.id), [
    "npm-isolated",
    "upstream-managed",
    "manual-development"
  ]);
  assert.equal(methods.methods[1].migrateFromNpm, "nastech-npm migrate upstream --yes");
});

test("checks the canonical package at the official npm registry", async (context) => {
  let requestedUrl = null;
  context.mock.method(globalThis, "fetch", async (url) => {
    requestedUrl = url;
    return {
      ok: true,
      json: async () => ({ "dist-tags": { latest: "0.20.1" } })
    };
  });

  assert.equal(await fetchLatestNpmVersion(), "0.20.1");
  assert.equal(requestedUrl, "https://registry.npmjs.org/nastech-agent");
});

test("builds exact-version npm install arguments against the canonical registry", () => {
  assert.deepEqual(
    getReleaseUpdateArgs("0.20.1", { isGlobal: false }),
    ["install", "--registry", "https://registry.npmjs.org", "nastech-agent@0.20.1"]
  );
  assert.deepEqual(
    getReleaseUpdateArgs("0.20.1", { isGlobal: true }),
    ["install", "--global", "--registry", "https://registry.npmjs.org", "nastech-agent@0.20.1"]
  );
  assert.equal(getReleaseUpdateArgs("0.20.1", { isGlobal: false }).some((arg) => arg.includes("@latest")), false);
  assert.throws(() => getReleaseUpdateArgs("latest", { isGlobal: false }), /Invalid npm semver/);
});

test("prints exact local commands for a manual alias migration", () => {
  const commands = getAliasMigrationCommands(
    "0.20.1",
    { isGlobal: false },
    "nastechagent",
    "nastech-agent"
  );
  assert.deepEqual(commands, [
    "npm uninstall nastechagent",
    "npm install --registry https://registry.npmjs.org nastech-agent@0.20.1"
  ]);
  assert.throws(
    () => assertReleaseUpdateAllowed("0.20.1", { isGlobal: false }, "nastechagent", "nastech-agent"),
    (error) => commands.every((command) => error.message.includes(command))
  );
});

test("prints exact global commands for a manual alias migration", () => {
  const commands = getAliasMigrationCommands(
    "0.20.1",
    { isGlobal: true },
    "nastechagent",
    "nastech-agent"
  );
  assert.deepEqual(commands, [
    "npm uninstall --global nastechagent",
    "npm install --global --registry https://registry.npmjs.org nastech-agent@0.20.1"
  ]);
});

test("allows the canonical package to apply a checked release update", () => {
  assert.equal(
    getAliasMigrationCommands("0.20.1", { isGlobal: false }, "nastech-agent", "nastech-agent"),
    null
  );
  assert.doesNotThrow(
    () => assertReleaseUpdateAllowed("0.20.1", { isGlobal: false }, "nastech-agent", "nastech-agent")
  );
});

test("compares global install paths case-insensitively only on Windows", () => {
  const mixedCasePath = "C:\\Users\\Example\\AppData\\Roaming\\npm\\node_modules";
  const lowerCasePath = mixedCasePath.toLowerCase();
  assert.equal(pathsReferToSameInstallLocation(mixedCasePath, lowerCasePath, "win32"), true);
  assert.equal(pathsReferToSameInstallLocation(mixedCasePath, lowerCasePath, "linux"), false);
  assert.equal(pathsReferToSameInstallLocation("/opt/node_modules", "/opt/node_modules", "darwin"), true);
});

test("reports every tracked runtime path returned by Git porcelain status", () => {
  assert.deepEqual(parseGitStatusPorcelain(""), []);
  assert.deepEqual(
    parseGitStatusPorcelain(" M contributors/emails/example\r\nR  old.py -> new.py\n"),
    [" M contributors/emails/example", "R  old.py -> new.py"]
  );
});

test("requires a successful clean Git status before reporting the release channel", () => {
  const commit = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  assert.equal(isReleasePinned(true, commit, commit, []), true);
  assert.equal(isReleasePinned(true, commit, commit, [" M runtime.py"]), false);
  assert.equal(isReleasePinned(true, commit, commit, null), false);
});
