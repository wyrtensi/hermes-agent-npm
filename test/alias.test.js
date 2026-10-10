const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const {
  getAliasPackageName,
  getPackageBinNames,
  getRelatedPackageNames
} = require("../lib/package-metadata");
const packageJson = require("../package.json");

test("recognizes nastech-agent as related to nastechagent", () => {
  assert.deepEqual(getRelatedPackageNames("nastech-agent"), ["nastechagent"]);
});

test("recognizes nastechagent as related to nastech-agent", () => {
  assert.deepEqual(getRelatedPackageNames("nastechagent"), ["nastech-agent"]);
});

test("builds alias package names from the canonical package", () => {
  assert.equal(getAliasPackageName("nastech-agent"), "nastechagent");
});

test("keeps canonical package name unchanged for unknown names", () => {
  assert.equal(getAliasPackageName("custom-name"), "custom-name");
});

test("adds nastechagent binary only to the alias package", () => {
  assert.deepEqual(getPackageBinNames("nastech-agent"), ["nastech", "nastech-agent", "nastech-npm"]);
  assert.deepEqual(getPackageBinNames("nastechagent"), ["nastech", "nastech-agent", "nastech-npm", "nastechagent"]);
});

test("maps canonical package binaries to separate wrapper files", () => {
  assert.deepEqual(packageJson.bin, {
    nastech: "bin/nastech.js",
    "nastech-agent": "bin/nastech-agent.js",
    "nastech-npm": "bin/nastech-npm.js"
  });
});

test("maps alias package binaries to wrapper files", () => {
  const binEntries = Object.fromEntries(
    getPackageBinNames("nastechagent").map((name) => [
      name,
      name === "nastech"
        ? "bin/nastech.js"
        : name === "nastech-npm"
          ? "bin/nastech-npm.js"
          : "bin/nastech-agent.js"
    ])
  );

  assert.deepEqual(binEntries, {
    nastech: "bin/nastech.js",
    "nastech-agent": "bin/nastech-agent.js",
    "nastech-npm": "bin/nastech-npm.js",
    nastechagent: "bin/nastech-agent.js"
  });
});

test("ships every helper required by the alias postinstall script", () => {
  const root = path.resolve(__dirname, "..");
  const result = spawnSync(process.execPath, [path.join(root, "scripts", "build-alias-package.js")], {
    cwd: root,
    encoding: "utf8",
    windowsHide: true
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(fs.existsSync(path.join(root, "dist", "nastechagent", "lib", "runtime-checkout.js")), true);
});
