const { spawn } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const repoRoot = path.resolve(__dirname, "..", "..");

// Stands in for scripts/postinstall.js: records each run, optionally waits or
// fails, and otherwise creates the venv console executable and runtime marker
// the real installer would leave behind. On Windows the "executable" is a link
// to (or copy of) node.exe, so '--version' prints process.version.
const FAKE_POSTINSTALL = `
const fs = require("node:fs");
const path = require("node:path");
const root = path.resolve(__dirname, "..");
const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
fs.appendFileSync(path.join(root, "postinstall-runs.log"), process.pid + "\\n");
console.log("fake postinstall stdout");
const delay = Number(process.env.FAKE_POSTINSTALL_DELAY_MS || 0);
if (delay > 0) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, delay);
if (process.env.FAKE_POSTINSTALL_EXIT) process.exit(Number(process.env.FAKE_POSTINSTALL_EXIT));
const venv = path.join(root, ...(pkg.hermesAgent.runtimeDirectory || "runtime/hermes-agent").split("/"), "venv");
if (process.platform === "win32") {
  const target = path.join(venv, "Scripts", "hermes.exe");
  fs.mkdirSync(path.dirname(target), { recursive: true });
  try { fs.linkSync(process.execPath, target); } catch { fs.copyFileSync(process.execPath, target); }
} else {
  const target = path.join(venv, "bin", "hermes");
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, "#!/bin/sh\\necho \\"fake-hermes $*\\"\\n", { mode: 0o755 });
}
fs.writeFileSync(path.join(root, ".hermes-agent-runtime.json"), JSON.stringify({ npmVersion: pkg.version }));
`;

function writeFakePostinstall(packageRoot) {
  fs.mkdirSync(path.join(packageRoot, "scripts"), { recursive: true });
  fs.writeFileSync(path.join(packageRoot, "scripts", "postinstall.js"), FAKE_POSTINSTALL);
}

// Copies the bridge shims and libraries into a temporary package root whose
// postinstall is the fake above, so the real launcher can be exercised
// without downloading Python.
function createFakePackage(context, overrides = {}) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "hermes-npm-test-"));
  context.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const packageRoot = path.join(base, "node_modules", "hermes-agent");
  fs.mkdirSync(packageRoot, { recursive: true });
  fs.cpSync(path.join(repoRoot, "bin"), path.join(packageRoot, "bin"), { recursive: true });
  fs.cpSync(path.join(repoRoot, "lib"), path.join(packageRoot, "lib"), { recursive: true });
  const packageJson = JSON.parse(fs.readFileSync(path.join(repoRoot, "package.json"), "utf8"));
  fs.writeFileSync(
    path.join(packageRoot, "package.json"),
    JSON.stringify({ ...packageJson, ...overrides }, null, 2)
  );
  writeFakePostinstall(packageRoot);
  return { base, packageRoot };
}

function countPostinstallRuns(packageRoot) {
  try {
    return fs.readFileSync(path.join(packageRoot, "postinstall-runs.log"), "utf8").trim().split(/\r?\n/u).filter(Boolean).length;
  } catch {
    return 0;
  }
}

function expectedFakeVersionOutput() {
  return process.platform === "win32" ? process.version : "fake-hermes --version";
}

function runNode(script, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script, ...args], {
      cwd: options.cwd,
      env: { ...process.env, HERMES_NPM_AUTO_SETUP: "", ...options.env },
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (status) => resolve({ status, stdout, stderr }));
  });
}

module.exports = {
  countPostinstallRuns,
  createFakePackage,
  expectedFakeVersionOutput,
  runNode,
  writeFakePostinstall
};
