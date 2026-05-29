const assert = require("node:assert/strict");
const test = require("node:test");

const {
  buildPythonInvocation,
  getPythonCandidates,
  getPythonEntryPoint,
  getPythonPackageSpec
} = require("../lib/python-launcher");
const packageJson = require("../package.json");

test("uses python3 before python on Unix-like systems", () => {
  assert.deepEqual(getPythonCandidates("linux"), [
    { command: "python3", args: [] },
    { command: "python", args: [] }
  ]);
});

test("uses the Windows launcher before plain python on Windows", () => {
  assert.deepEqual(getPythonCandidates("win32"), [
    { command: "py", args: ["-3"] },
    { command: "python", args: [] },
    { command: "python3", args: [] }
  ]);
});

test("maps the hermes npm bin to the Python CLI module", () => {
  assert.equal(getPythonEntryPoint("hermes"), "hermes_cli.main");
  assert.equal(getPythonEntryPoint("hermes.exe"), "hermes_cli.main");
});

test("maps the hermes-agent npm bin to the Python agent module", () => {
  assert.equal(getPythonEntryPoint("hermes-agent"), "run_agent");
  assert.equal(getPythonEntryPoint("hermes-agent.cmd"), "run_agent");
});

test("builds a Python -c invocation that preserves user arguments", () => {
  const invocation = buildPythonInvocation(
    { command: "python3", args: [] },
    "hermes-agent",
    ["--model", "nous"]
  );

  assert.equal(invocation.command, "python3");
  assert.deepEqual(invocation.args.slice(0, 2), ["-c", "from run_agent import main; raise SystemExit(main())"]);
  assert.deepEqual(invocation.args.slice(2), ["--model", "nous"]);
});

test("pins the Python package to the npm package version", () => {
  assert.equal(getPythonPackageSpec(), `hermes-agent==${packageJson.hermesAgent.pythonPackageVersion}`);
});
