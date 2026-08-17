const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { configureRuntimeSparseCheckout } = require("../lib/runtime-checkout");

function git(args, options = {}) {
  const result = spawnSync("git", args, {
    encoding: "utf8",
    input: options.input,
    windowsHide: true
  });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${(result.stderr || result.stdout).trim()}`);
  }
  return result.stdout.trim();
}

test("keeps runtime source while omitting contributor metadata from the checkout", () => {
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "hermes-runtime-checkout-"));
  const origin = path.join(temporaryRoot, "origin");
  const checkout = path.join(temporaryRoot, "checkout");

  try {
    git(["init", "--bare", origin]);
    const projectBlob = git(
      ["-C", origin, "hash-object", "-w", "--stdin"],
      { input: "[project]\nname = \"fixture\"\n" }
    );
    const upperCaseBlob = git(
      ["-C", origin, "hash-object", "-w", "--stdin"],
      { input: "skip-agent\n" }
    );
    const lowerCaseBlob = git(
      ["-C", origin, "hash-object", "-w", "--stdin"],
      { input: "momomojo\n" }
    );
    const emailsTree = git(
      ["-C", origin, "mktree"],
      {
        input:
          `100644 blob ${upperCaseBlob}\tagent@Agents-Mac-mini.local\n` +
          `100644 blob ${lowerCaseBlob}\tagent@agents-Mac-mini.local\n`
      }
    );
    const contributorsTree = git(
      ["-C", origin, "mktree"],
      { input: `040000 tree ${emailsTree}\temails\n` }
    );
    const rootTree = git(
      ["-C", origin, "mktree"],
      {
        input:
          `100644 blob ${projectBlob}\tpyproject.toml\n` +
          `040000 tree ${contributorsTree}\tcontributors\n`
      }
    );
    const commit = git([
      "-C", origin,
      "-c", "user.name=Hermes Test",
      "-c", "user.email=test@example.invalid",
      "commit-tree", rootTree, "-m", "fixture"
    ]);
    git(["-C", origin, "update-ref", "refs/heads/main", commit]);
    git(["-C", origin, "symbolic-ref", "HEAD", "refs/heads/main"]);
    git(["clone", "--no-checkout", origin, checkout]);
    const trackedPaths = git(["-C", checkout, "ls-tree", "-r", "--name-only", commit]);
    assert.match(trackedPaths, /agent@Agents-Mac-mini\.local/);
    assert.match(trackedPaths, /agent@agents-Mac-mini\.local/);

    configureRuntimeSparseCheckout(checkout, git);
    git(["-C", checkout, "checkout", "--detach", commit]);

    assert.equal(fs.existsSync(path.join(checkout, "pyproject.toml")), true);
    assert.equal(fs.existsSync(path.join(checkout, "contributors")), false);
    assert.equal(git(["-C", checkout, "status", "--porcelain", "--untracked-files=no"]), "");
  } finally {
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
});
