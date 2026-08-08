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
  assert.ok(getConsoleExecutable("hermes", "win32").endsWith(path.join("venv", "Scripts", "hermes.exe")));
  assert.ok(getConsoleExecutable("hermes-agent", "win32").endsWith(path.join("venv", "Scripts", "hermes-agent.exe")));
});

test("uses native upstream console entrypoints on POSIX", () => {
  assert.ok(getConsoleExecutable("hermes", "linux").endsWith(path.join("venv", "bin", "hermes")));
  assert.ok(getConsoleExecutable("hermes-agent", "darwin").endsWith(path.join("venv", "bin", "hermes-agent")));
});

test("preserves user arguments without Python code injection", () => {
  const invocation = buildConsoleInvocation("hermes", ["update", "--check"]);
  assert.equal(invocation.command, getConsoleExecutable("hermes"));
  assert.deepEqual(invocation.args, ["update", "--check"]);
});

test("normalizes npm command shim suffixes", () => {
  assert.equal(normalizeBinName("hermes.cmd"), "hermes");
  assert.equal(normalizeBinName("hermes-agent.exe"), "hermes-agent");
});

test("marks the child process as npm-provisioned without enabling upstream managed mode", () => {
  const env = getRuntimeEnvironment();
  assert.equal(env.HERMES_NPM_BRIDGE, "1");
  assert.equal(env.VIRTUAL_ENV, getVenvDirectory());
  assert.equal(env.HERMES_MANAGED, process.env.HERMES_MANAGED);
});
