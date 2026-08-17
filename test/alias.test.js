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

test("recognizes hermes-agent as related to hermesagent", () => {
  assert.deepEqual(getRelatedPackageNames("hermes-agent"), ["hermesagent"]);
});

test("recognizes hermesagent as related to hermes-agent", () => {
  assert.deepEqual(getRelatedPackageNames("hermesagent"), ["hermes-agent"]);
});

test("builds alias package names from the canonical package", () => {
  assert.equal(getAliasPackageName("hermes-agent"), "hermesagent");
});

test("keeps canonical package name unchanged for unknown names", () => {
  assert.equal(getAliasPackageName("custom-name"), "custom-name");
});

test("adds hermesagent binary only to the alias package", () => {
  assert.deepEqual(getPackageBinNames("hermes-agent"), ["hermes", "hermes-agent", "hermes-npm"]);
  assert.deepEqual(getPackageBinNames("hermesagent"), ["hermes", "hermes-agent", "hermes-npm", "hermesagent"]);
});

test("maps canonical package binaries to separate wrapper files", () => {
  assert.deepEqual(packageJson.bin, {
    hermes: "bin/hermes.js",
    "hermes-agent": "bin/hermes-agent.js",
    "hermes-npm": "bin/hermes-npm.js"
  });
});

test("maps alias package binaries to wrapper files", () => {
  const binEntries = Object.fromEntries(
    getPackageBinNames("hermesagent").map((name) => [
      name,
      name === "hermes"
        ? "bin/hermes.js"
        : name === "hermes-npm"
          ? "bin/hermes-npm.js"
          : "bin/hermes-agent.js"
    ])
  );

  assert.deepEqual(binEntries, {
    hermes: "bin/hermes.js",
    "hermes-agent": "bin/hermes-agent.js",
    "hermes-npm": "bin/hermes-npm.js",
    hermesagent: "bin/hermes-agent.js"
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
  assert.equal(fs.existsSync(path.join(root, "dist", "hermesagent", "lib", "runtime-checkout.js")), true);
});
