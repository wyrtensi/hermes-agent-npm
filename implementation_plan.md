# Dual-channel npm bridge implementation plan

## Goals

- Replace the discontinued upstream PyPI installation path.
- Preserve native upstream `hermes update` as the default rolling updater.
- Add a separate npm release-pinned update channel.
- Keep Python and dependencies isolated inside the npm package.
- Avoid executing upstream developer installation scripts.
- Provide an explicit, verified one-way handoff for users who choose upstream
  ownership and its conventional source directory.

## Implemented design

1. GitHub Release polling resolves the upstream tag, project version, and final
   commit behind annotated tags.
2. `postinstall` creates a real Git checkout at that exact commit.
3. A pinned Astral `uv` binary provisions managed Python 3.11.
4. `uv sync --locked --extra all --no-dev` installs the editable upstream
   project into `runtime/hermes-agent/venv`.
5. npm shims execute upstream console entrypoints directly.
6. `hermes update` is not parsed or replaced by the bridge.
7. `hermes-npm status/check/update` owns the npm Release channel.
8. npm reinstall intentionally resets a rolling checkout to a published
   Release; same-version rebuild preserves it.
9. `hermes-npm methods/help` exposes install, update, removal, and ownership
   choices in human-readable and JSON forms.
10. `hermes-npm migrate upstream` is dry-run by default. Its `--yes` form runs
    the official installer from the verified checkout, pins and verifies the
    same commit, then removes the npm package. Normal npm installation never
    invokes that script.

## Verification status

- Local unit, runtime smoke, tarball, shim, metadata-sync, YAML, and security
  checks pass on Windows.
- Regular CI and the publish gate require full installation and native-update
  smoke tests on Windows, macOS, and Linux.
- npm Release updates are bound to the exact checked version and canonical
  registry; the legacy alias requires an explicit manual migration.
- The security policy covers download, Git, lifecycle, native-update, npm
  provenance, filesystem, and configuration boundaries.
- Hosted Windows/macOS/Linux CI remains the final pre-publication gate.
