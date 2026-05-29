const assert = require("node:assert/strict");
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
  assert.deepEqual(getPackageBinNames("hermes-agent"), ["hermes", "hermes-agent"]);
  assert.deepEqual(getPackageBinNames("hermesagent"), ["hermes", "hermes-agent", "hermesagent"]);
});

test("maps canonical package binaries to separate wrapper files", () => {
  assert.deepEqual(packageJson.bin, {
    hermes: "bin/hermes.js",
    "hermes-agent": "bin/hermes-agent.js"
  });
});

test("maps alias package binaries to wrapper files", () => {
  const binEntries = Object.fromEntries(
    getPackageBinNames("hermesagent").map((name) => [
      name,
      name === "hermes" ? "bin/hermes.js" : "bin/hermes-agent.js"
    ])
  );

  assert.deepEqual(binEntries, {
    hermes: "bin/hermes.js",
    "hermes-agent": "bin/hermes-agent.js",
    hermesagent: "bin/hermes-agent.js"
  });
});
