const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");

const {
  buildConsoleInvocation,
  getConsoleExecutable,
  getRuntimeEnvironment,
  getRuntimeSourceDirectory,
  getVenvDirectory,
  normalizeBinName
} = require("../lib/python-launcher");

test("places the venv inside the upstream checkout", () => {
  assert.equal(getVenvDirectory(), path.join(getRuntimeSourceDirectory(), "venv"));
});

test("uses native upstream console entrypoints on Windows", () => {
  assert.ok(getConsoleExecutable("nastech", "win32").endsWith(path.join("venv", "Scripts", "nastech.exe")));
  assert.ok(getConsoleExecutable("nastech-agent", "win32").endsWith(path.join("venv", "Scripts", "nastech-agent.exe")));
});

test("uses native upstream console entrypoints on POSIX", () => {
  assert.ok(getConsoleExecutable("nastech", "linux").endsWith(path.join("venv", "bin", "nastech")));
  assert.ok(getConsoleExecutable("nastech-agent", "darwin").endsWith(path.join("venv", "bin", "nastech-agent")));
});

test("preserves user arguments without Python code injection", () => {
  const invocation = buildConsoleInvocation("nastech", ["update", "--check"]);
  assert.equal(invocation.command, getConsoleExecutable("nastech"));
  assert.deepEqual(invocation.args, ["update", "--check"]);
});

test("normalizes npm command shim suffixes", () => {
  assert.equal(normalizeBinName("nastech.cmd"), "nastech");
  assert.equal(normalizeBinName("nastech-agent.exe"), "nastech-agent");
});

test("marks the child process as npm-provisioned without enabling upstream managed mode", () => {
  const env = getRuntimeEnvironment();
  assert.equal(env.NASTECH_NPM_BRIDGE, "1");
  assert.equal(env.VIRTUAL_ENV, getVenvDirectory());
  assert.equal(env.NASTECH_MANAGED, process.env.NASTECH_MANAGED);
});
