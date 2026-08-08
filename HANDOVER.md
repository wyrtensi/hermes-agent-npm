# Implementation handover — locally complete 2026-08-08

## Current status

The dual-channel npm bridge implementation is complete in the working tree and
has passed the available local verification on Windows. It has not been
committed, pushed, published, or exercised on hosted macOS/Linux runners.

Git base: `c020305cd3ff4c47c2b1fa1e44a2ea4d5695ccf0`.

## Implemented architecture

- `hermes` and `hermes-agent` launch the real console executables from a
  package-local virtual environment.
- `hermes update` and `hermes update --check` pass unchanged to the native
  upstream rolling updater.
- `hermes-npm status/check/update` owns the npm Release channel.
- `hermes-npm methods/help` documents all supported ownership models for users
  and agents.
- `hermes-npm migrate upstream` plans a safe one-way transfer to the standard
  user-scoped upstream checkout; `--yes` executes the pinned installer,
  verifies it, then removes the npm package.
- Installation uses a shallow Git checkout pinned to upstream tag
  `v2026.8.3` and peeled commit
  `3c27eb6234bf91b8ceee9e9071591b31e9b148cb`.
- Checksum-pinned `uv` 0.12.2 provisions package-local Python 3.11 and runs
  upstream `uv sync --locked --extra all --no-dev`.
- No upstream installer script, PyPI Hermes package, system-Python fallback,
  shell pipeline, or `HERMES_NIX_BUILD` bypass is used.
- The only upstream-installer path is the separately confirmed handoff. It is
  never invoked by npm lifecycle provisioning.
- GitHub Release polling, CI, and publication gates are defined for Windows,
  macOS, and Linux. npm OIDC permission exists only in the publish job.

## Update-channel behavior

`hermes-npm check` reads the canonical public npm registry. An npm update is
bound to the exact checked semver and the same
`https://registry.npmjs.org` endpoint; it never performs a second mutable
`@latest` resolution. Package downgrades are refused.

If the installed npm version already matches the Release channel, a clean
native-updated checkout can be reset in place to the pinned commit. Dirty or
damaged checkouts use transactional replacement. Same-version `npm rebuild`
preserves a valid rolling checkout.

The build-only `hermesagent` alias checks the canonical channel but refuses an
automatic alias-to-canonical migration. It prints exact local/global commands
that remove the alias and install the checked canonical version, preventing a
silent second isolated runtime.

## Runtime layout

```text
.hermes-agent-runtime.json
.uv_bin/
runtime/python/
runtime/hermes-agent/.git/
runtime/hermes-agent/venv/
```

## Security state

The recorded working-tree security snapshot was completed and sealed with no
reportable findings:

- scan ID: `3c174a14-945a-473e-9b36-c029b30a11f9`;
- report:
  `C:\Users\wyrtensi\AppData\Local\Temp\codex-security-scans-1VLsq6\hermesnpm\c020305cd3ff4c47c2b1fa1e44a2ea4d5695ccf0_20260807T104613Z_ne1vkb40\report.md`.

The scan identified one non-reportable defense-in-depth issue: the checked npm
version was not bound to the install subprocess. That issue is now fixed with
exact-version and explicit-registry arguments and covered by unit tests.

The later upstream-handoff implementation is not covered by that immutable
scan snapshot. It received an independent focused review plus primary-agent
review; findings around shared global bin ownership, dirty target prompts,
symlink/junction containment, and recovery-command quoting were fixed and
regression-tested. No blocker remained in the final focused review. Run a new
full diff/repository security scan on the stabilized commit if a sealed report
covering the handoff is required before publication.

`SECURITY.md` now documents supported versions, private reporting, installer
invariants, download verification, update trust boundaries, filesystem and
network boundaries, publishing permissions, accepted risks, and the audit path
using `--ignore-scripts`.

## Completed verification

- `npm test`: 44 passed and three POSIX-only tests skipped on Windows,
  including handoff path/argument/order/finalization guards.
- `npm run smoke`: passed for `v2026.8.3` at `3c27eb6234bf`.
- Root `npm pack --dry-run`: passed; 16 intended files.
- Alias build and `npm pack --dry-run`: passed; 16 intended files.
- Live `hermes-npm check --json`: passed and reported local `0.20.0` ahead
  of currently published npm `0.19.0`.
- GitHub Release synchronization resolved the expected release, exact commit,
  and project version.
- Python syntax and both workflow YAML files parsed successfully.
- `git diff --check`: passed; only Git line-ending conversion warnings remain.
- Earlier end-to-end checks also passed for first-time Windows provisioning,
  native `hermes update --check`, rolling drift detection, release reset, and
  post-reset smoke.
- All 18 committed `uv` checksums were compared with Astral's official 0.12.2
  release checksums.

## Required before publication

1. Review the complete working-tree diff.
2. Commit and push using the maintainer's identity.
3. Require the GitHub Actions Windows/macOS/Linux CI matrix to pass.
4. Confirm npm trusted-publisher configuration and branch protection.
5. Publish only after the release workflow re-resolves the same tag, commit,
   and version and all three runtime smoke jobs succeed.

Do not claim local macOS/Linux runtime proof: those operating systems are
covered structurally and by blocking workflows, but their actual proof is the
hosted CI run.

No commit, push, PR, or npm publication was performed during this session.
