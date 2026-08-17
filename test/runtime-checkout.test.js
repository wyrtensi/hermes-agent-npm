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
    fs.mkdirSync(path.join(origin, "contributors", "emails"), { recursive: true });
    fs.writeFileSync(path.join(origin, "pyproject.toml"), "[project]\nname = \"fixture\"\n", "utf8");
    fs.writeFileSync(path.join(origin, "contributors", "emails", "example"), "metadata\n", "utf8");
    git(["init", origin]);
    git(["-C", origin, "add", "."]);
    git([
      "-C", origin,
      "-c", "user.name=Hermes Test",
      "-c", "user.email=test@example.invalid",
      "commit", "-m", "fixture"
    ]);
    const commit = git(["-C", origin, "rev-parse", "HEAD"]);
    git(["clone", "--no-checkout", origin, checkout]);

    configureRuntimeSparseCheckout(checkout, git);
    git(["-C", checkout, "checkout", "--detach", commit]);

    assert.equal(fs.existsSync(path.join(checkout, "pyproject.toml")), true);
    assert.equal(fs.existsSync(path.join(checkout, "contributors")), false);
    assert.equal(git(["-C", checkout, "status", "--porcelain", "--untracked-files=no"]), "");
  } finally {
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
});
