const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const syncScript = path.resolve(__dirname, "..", "scripts", "sync_upstream_version.py");

function fixturePackage() {
  return {
    name: "nastech-agent",
    version: "0.0.0",
    description: "before",
    nastechAgent: {
      pythonPackageVersion: "stale"
    }
  };
}

function runOfflineSync(extraEnvironment = {}) {
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "nastech-sync-test-"));
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
    assert.equal(packageJson.description, "Unofficial npm bridge for Nastech Agent 9.8.7: Future fixture release");
    assert.deepEqual(packageJson.nastechAgent, {
      upstreamVersion: "9.8.7",
      upstreamRepository: "NastechResearch/nastech-agent",
      upstreamGitTag: "v2099.1.1",
      upstreamCommit: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      pythonVersion: "3.14",
      installerFinalizeStage: "products",
      runtimeDirectory: "runtime/nastech-agent"
    });
  } finally {
    execution.cleanup();
  }
});

test("uses the semantic Release tag when upstream project.version is a placeholder", () => {
  const execution = runOfflineSync({
    EXPECTED_UPSTREAM_TAG: "v0.21.6",
    EXPECTED_UPSTREAM_VERSION: "0.0.0"
  });
  try {
    assert.equal(execution.result.status, 0, execution.result.stderr);
    const packageJson = JSON.parse(fs.readFileSync(execution.packagePath, "utf8"));
    assert.equal(packageJson.version, "0.21.6");
    assert.equal(packageJson.nastechAgent.upstreamVersion, "0.21.6");
    assert.match(execution.result.stdout, /^version=0\.21\.6$/m);
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

for (const [name, environment, expectedError] of [
  ["tag", { EXPECTED_UPSTREAM_TAG: "not-a-tag" }, /Invalid upstream tag/],
  ["commit", { EXPECTED_UPSTREAM_COMMIT: "abc123" }, /Invalid upstream commit/],
  ["version", { EXPECTED_UPSTREAM_VERSION: "latest" }, /Invalid upstream version/],
  ["base64", { EXPECTED_UPSTREAM_DESCRIPTION_B64: "%%%" }, /not valid base64 UTF-8/],
  [
    "UTF-8 description",
    { EXPECTED_UPSTREAM_DESCRIPTION_B64: Buffer.from([0xff]).toString("base64") },
    /not valid base64 UTF-8/
  ]
]) {
  test(`refuses malformed prepared Release ${name} without changing package.json`, () => {
    const execution = runOfflineSync(environment);
    try {
      assert.notEqual(execution.result.status, 0);
      assert.match(execution.result.stderr, expectedError);
      assert.deepEqual(JSON.parse(fs.readFileSync(execution.packagePath, "utf8")), fixturePackage());
    } finally {
      execution.cleanup();
    }
  });
}
