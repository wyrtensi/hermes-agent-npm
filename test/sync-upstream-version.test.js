const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const syncScript = path.resolve(__dirname, "..", "scripts", "sync_upstream_version.py");

function fixturePackage() {
  return {
    name: "hermes-agent",
    version: "0.0.0",
    description: "before",
    hermesAgent: {
      pythonPackageVersion: "stale"
    }
  };
}

function runOfflineSync(extraEnvironment = {}) {
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "hermes-sync-test-"));
  const packagePath = path.join(temporaryRoot, "package.json");
  fs.writeFileSync(packagePath, `${JSON.stringify(fixturePackage(), null, 2)}\n`, "utf8");
  const description = "Future fixture release";
  const result = spawnSync("python", [syncScript], {
    cwd: temporaryRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      SYNC_FROM_EXPECTED: "1",
      EXPECTED_UPSTREAM_TAG: "v2099.1.1",
      EXPECTED_UPSTREAM_COMMIT: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      EXPECTED_UPSTREAM_VERSION: "9.8.7",
      EXPECTED_UPSTREAM_DESCRIPTION_B64: Buffer.from(description, "utf8").toString("base64"),
      ...extraEnvironment
    },
    windowsHide: true
  });
  return {
    cleanup: () => fs.rmSync(temporaryRoot, { recursive: true, force: true }),
    packagePath,
    result
  };
}

test("applies complete prepared Release metadata without rediscovering GitHub latest", () => {
  const execution = runOfflineSync();
  try {
    assert.equal(execution.result.status, 0, execution.result.stderr);
    const packageJson = JSON.parse(fs.readFileSync(execution.packagePath, "utf8"));
    assert.equal(packageJson.version, "9.8.7");
    assert.equal(packageJson.description, "Unofficial npm bridge for Hermes Agent 9.8.7: Future fixture release");
    assert.deepEqual(packageJson.hermesAgent, {
      upstreamVersion: "9.8.7",
      upstreamRepository: "NousResearch/hermes-agent",
      upstreamGitTag: "v2099.1.1",
      upstreamCommit: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      pythonVersion: "3.11",
      runtimeDirectory: "runtime/hermes-agent"
    });
  } finally {
    execution.cleanup();
  }
});

test("refuses incomplete prepared Release metadata without changing package.json", () => {
  const execution = runOfflineSync({ EXPECTED_UPSTREAM_DESCRIPTION_B64: "" });
  try {
    assert.notEqual(execution.result.status, 0);
    assert.match(execution.result.stderr, /EXPECTED_UPSTREAM_DESCRIPTION_B64/);
    assert.deepEqual(JSON.parse(fs.readFileSync(execution.packagePath, "utf8")), fixturePackage());
  } finally {
    execution.cleanup();
  }
});
