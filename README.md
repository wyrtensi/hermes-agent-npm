# nastech-agent npm bridge

[![npm version](https://img.shields.io/npm/v/nastech-agent?logo=npm)](https://www.npmjs.com/package/nastech-agent)
[![npm downloads](https://img.shields.io/npm/dm/nastech-agent?logo=npm)](https://www.npmjs.com/package/nastech-agent)
[![CI](https://github.com/nastechresearch/nastech-agent-npm/actions/workflows/ci.yml/badge.svg)](https://github.com/nastechresearch/nastech-agent-npm/actions/workflows/ci.yml)
[![Upstream release](https://img.shields.io/github/v/release/NastechResearch/nastech-agent?label=upstream&logo=github)](https://github.com/NastechResearch/nastech-agent/releases)
[![Node.js 20+](https://img.shields.io/badge/Node.js-20%2B-339933?logo=nodedotjs&logoColor=white)](https://nodejs.org/)
[![npm provenance](https://img.shields.io/badge/npm%20provenance-enabled-brightgreen)](https://docs.npmjs.com/generating-provenance-statements)
[![Telegram chat](https://img.shields.io/badge/Telegram-chat-26A5E4?logo=telegram&logoColor=white)](https://t.me/+AoFg5hgLSlIyYTAy)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

> [!IMPORTANT]
> **The deployment model changed in `0.20.0`.** Upstream Nastech Agent stopped
> publishing new PyPI releases. This bridge now creates a package-local Git
> checkout and an isolated Python runtime managed by `uv`. Existing users must
> reinstall the npm package. Python is no longer required on the host, but Git
> is required so the native `nastech update` command works consistently.

An unofficial npm bridge for [Nastech Agent](https://github.com/NastechResearch/nastech-agent)
by Nastech Research. It exposes the upstream `nastech` and `nastech-agent` commands
through npm. Normal npm installation does not execute the upstream shell or
PowerShell installers. An explicit, confirmed upstream handoff can run the
installer stored in the verified Release checkout.

This project is not affiliated with, endorsed by, sponsored by, or maintained
by Nastech Research.

## Contents

- [Choose an installation method](#choose-an-installation-method)
- [Migration from pre-0.20](#migration-from-pre-020)
- [Install](#install)
- [Two update channels](#two-update-channels)
- [Move from npm to an upstream-managed install](#move-from-npm-to-an-upstream-managed-install)
- [Commands](#commands)
- [How installation works](#how-installation-works)
- [Runtime layout and isolation](#runtime-layout-and-isolation)
- [Release automation](#release-automation)
- [Security and privacy](#security-and-privacy)
- [Troubleshooting](#troubleshooting)
- [Development](#development)
- [Legal and attribution](#legal-and-attribution)

## Choose an installation method

Choose one owner for the Nastech runtime. This table is intentionally near the
top so both people and repository-scanning agents see the deployment boundary
before copying an install command.

| Method | Install | Code and venv | Updates | Removal |
| --- | --- | --- | --- | --- |
| npm-isolated (recommended for npm users) | Global: `npm install --global nastech-agent`; project: `npm install nastech-agent` | Inside the npm package | `nastech update` or `nastech-npm update` | Matching global/project `npm uninstall` |
| upstream-managed | [Official upstream installer](https://github.com/NastechResearch/nastech-agent#quick-install) or the handoff below | User-scoped `$NASTECH_HOME/nastech-agent` | `nastech update` | `nastech uninstall` |
| manual development | [Upstream contributing guide](https://nastech-agent.nastechresearch.com/docs/developer-guide/contributing) | Developer checkout with an external venv | Developer-managed Git and `uv` | Remove the selected checkout and venv |

Machine-readable discovery:

```bash
nastech-npm methods --json
nastech-npm status --json
```

Human-readable command help:

```bash
nastech-npm help install
nastech-npm help update
nastech-npm help migrate
nastech-npm help uninstall
```

The npm default remains package-local deliberately. A global and several
project-local npm installations can then pin independent runtimes and npm can
remove everything it owns. Making every npm package write to one shared
`NASTECH_HOME/nastech-agent` would create cross-project version races and leave
files outside npm ownership.

For a new upstream-managed installation that has never been owned by npm, the
current official commands are:

```bash
# Linux, macOS, WSL2, Termux
curl -fsSL https://nastech-agent.nastechresearch.com/install.sh | bash
```

```powershell
# Native Windows PowerShell
iex (irm https://nastech-agent.nastechresearch.com/install.ps1)
```

Those commands execute the current upstream network endpoint and belong to the
upstream trust boundary. Existing npm users can instead use the handoff below,
which executes the installer already present in the bridge's verified Release
checkout and pins the same full commit.

## Migration from pre-0.20

Versions through `0.15.2` installed a pinned `nastech-agent` package into a host
Python environment. The upstream `nastech update` command then independently
checked and upgraded that Python package through PyPI. npm could report one
version while Python executed another.

That legacy code was normally stored in the selected Python environment's
global or user `site-packages`; it was not an official source checkout at
`$NASTECH_HOME/nastech-agent`. User configuration and state did use the normal
upstream `NASTECH_HOME`, as they still do now.

Starting with `0.20.0`:

- PyPI is not used to install Nastech Agent itself;
- `uv` downloads the isolated managed Python version pinned in the npm package
  metadata;
- upstream source is checked out at the exact GitHub Release tag and commit;
- dependencies are synchronized from upstream `uv.lock`;
- `nastech update` remains the native upstream rolling updater;
- `nastech-npm update` is the explicit npm Release updater.

Upgrade globally with:

```bash
npm install --global nastech-agent@latest
```

The bridge no longer searches for or launches a system Python. Any legacy
Python installation of Nastech Agent is independent and is not removed
automatically.

## Install

Prerequisites:

- Node.js 20 or newer;
- Git available as `git` in `PATH`;
- network access to GitHub, Astral's Python downloads, and the Python artifact
  indexes referenced by upstream.

Python, pip, curl, `tar`, and upstream installer scripts are not prerequisites.

Global installation:

```bash
npm install --global nastech-agent
nastech --help
```

Project installation:

```bash
npm install nastech-agent
npx nastech --help
```

The first install downloads Python and dependencies and can take several
minutes. A Windows test installation of `0.20.0` occupied about 450 MB after
the temporary dependency cache was removed; size varies by platform and future
upstream dependencies.

> [!WARNING]
> Stop running Nastech gateways and agents before an npm reinstall or npm-channel
> update. npm may replace the package-local checkout and virtual environment.

> [!CAUTION]
> While npm owns the deployment, do not run `nastech uninstall`. The upstream
> uninstaller operates on the checkout containing the running Python code and
> can delete the package-local runtime without removing the npm package. Use
> `npm uninstall nastech-agent` or `npm uninstall --global nastech-agent`.

## Two update channels

The bridge intentionally exposes two independent update channels.

| Channel | Command | Source | Result |
| --- | --- | --- | --- |
| Native rolling | `nastech update` | Upstream Git branch, normally `main` | Runs the unmodified upstream updater |
| npm Release | `nastech-npm update` | Latest published `nastech-agent` npm version | Returns to the latest GitHub Release pinned by npm |

### Native rolling channel

```bash
nastech update --check
nastech update
```

These arguments are passed directly to the official upstream console
entrypoint. The bridge does not replace `cmd_update`, set `NASTECH_MANAGED`, or
translate the command into npm operations.

After a native update, the source checkout can be newer than both the npm
package version and the latest upstream GitHub Release. This is expected. npm
integrity and provenance still cover the bridge package, but no longer attest
to source subsequently fetched by the native updater.

The upstream updater may also install its own managed tools, dependencies, or
runtime files according to upstream behavior. In the current upstream release,
that includes a managed `uv` under `NASTECH_HOME/bin` (normally `~/.nastech/bin`)
and may include checkout-local runtime-repair files. This is outside the npm
release-pinned boundary and is the explicit tradeoff for keeping native update
behavior unchanged.

### npm Release channel

Inspect the local relationship between npm and the live checkout:

```bash
nastech-npm status
nastech-npm status --json
```

Check the npm registry:

```bash
nastech-npm check
```

Return to or advance along the release-pinned channel:

```bash
nastech-npm update
```

When a newer npm version exists, `nastech-npm update` installs the exact version
returned by its check from the same canonical registry. It does not resolve the
mutable `latest` tag a second time. Depending on installation scope, the
effective command is equivalent to:

```bash
npm install --global --registry=https://registry.npmjs.org nastech-agent@<checked-version>
npm install --registry=https://registry.npmjs.org nastech-agent@<checked-version>
```

An npm update intentionally replaces native rolling changes with the exact
checkout pinned by the npm Release. If npm is already at the latest version but
the live checkout has moved, `nastech-npm update` directly reprovisions that
same release commit. This discards tracked source changes in the package-local
checkout; upstream user configuration under `NASTECH_HOME` is unaffected.
Running `npm rebuild` for the same package version instead
preserves an existing native-updated checkout and only resynchronizes its
environment.

### Python 3.14 in release 0.21.6

Upstream `v0.21.6` locks dependencies for Python 3.14. The corresponding npm
release downloads a managed Python 3.14 runtime with `uv`; a system Python 3.14
installation is not required.

If an existing npm installation uses Python 3.11, run `nastech-npm update` after
`nastech-agent@0.21.6` is published. Updating the npm package replaces its
package-local checkout and venv, then creates a new Python 3.14 venv from the
upstream lockfile. Configuration, credentials, sessions, and other data under
`NASTECH_HOME` remain in place. Rebuilding the old npm version does not perform
this transition.

For automation and agents, `nastech-npm status --json` is the canonical
machine-readable note. Child processes also receive:

```text
NASTECH_NPM_BRIDGE=1
NASTECH_NPM_PACKAGE_ROOT=<package directory>
NASTECH_NPM_PACKAGE_VERSION=<npm version>
NASTECH_NPM_RELEASE_TAG=<upstream release tag>
```

The bridge deliberately does not set `NASTECH_MANAGED`; upstream currently uses
that flag to prohibit configuration and setup changes in addition to updates.

## Move from npm to an upstream-managed install

Use a one-way handoff when you want the normal upstream source location, PATH
integration, native uninstaller, and `nastech update` as the sole update owner.
First inspect the exact plan; this makes no changes:

```bash
nastech-npm migrate upstream
nastech-npm migrate upstream --json
```

Stop running Nastech processes, then execute it explicitly:

```bash
nastech-npm migrate upstream --yes
```

The handoff:

1. requires the npm runtime to be at its exact Release-pinned commit;
2. uses `scripts/install.sh` or `scripts/install.ps1` from that already verified
   checkout rather than downloading a mutable installer endpoint;
3. passes the exact commit and uses non-interactive, skip-setup mode;
4. installs to the user-scoped `$NASTECH_HOME/nastech-agent` target on macOS and
   Linux or `%LOCALAPPDATA%\nastech\nastech-agent` on Windows, unless
   `NASTECH_HOME` is already set;
5. verifies the resulting Git commit and venv `nastech` executable;
6. only after successful verification, removes the npm package in its detected
   local or global scope;
7. re-runs the release's official command publication stage from the new checkout,
   so a global npm uninstall cannot delete an official launcher when
   both installations use the same bin directory.

Configuration, credentials, sessions, memories, skills, and other user state
under `NASTECH_HOME` are preserved. The command refuses a non-Git target, a Git
target with an unexpected origin or uncommitted files, a `NASTECH_HOME` inside
the npm package, or a runtime that has moved off its packaged Release. Run
`nastech-npm update` first if native rolling changes need to be reset before
handoff. Existing upstream checkout changes must be committed, stashed, or
removed explicitly; the bridge never answers an upstream restore prompt.

This is not a side-by-side mode. Two active checkouts sharing the same command
names, PATH entries, gateway definitions, ports, tokens, and user state cannot
be given reliable ownership across Windows, macOS, and Linux. To return later,
uninstall the upstream deployment while preserving the desired user data, then
install the npm package again.

Run the handoff as the account that should own `NASTECH_HOME`; do not add `sudo`
just because the existing global npm package is root-owned. If the final global
npm removal lacks permission, the verified upstream installation remains in
place and the command prints the exact npm removal command to run separately
with the permissions required by that npm prefix.

## Commands

```bash
nastech                 # primary upstream CLI
nastech-agent           # legacy/direct run_agent entrypoint
nastech-npm             # npm ownership, release channel, methods, and handoff
```

`nastech` should be preferred for normal use. `nastech-agent` preserves upstream
legacy behavior; notably, its Fire-based argument handling is not equivalent
to the main CLI, and `nastech-agent --help` may initialize the direct agent
instead of acting like `nastech --help`.

The npm package is named `nastech-agent`. The unscoped package name `nastech`
belongs to another project, so this package exposes `nastech` only as a binary.

The repository can also build an alias package named `nastechagent` for legacy
compatibility testing; it is not published by the automated release workflow.
Installing both names is unnecessary and creates two isolated runtimes. An
alias installation can check the canonical `nastech-agent` Release channel, but
it refuses to install the canonical package over the alias automatically.
Instead, it prints scope-appropriate commands that remove the alias first and
then install the exact checked canonical version.

### `nastech-npm` command reference

| Command | Effect |
| --- | --- |
| `nastech-npm status [--json]` | Report npm identity, exact live Git commit, channel, dirty state, and install scope |
| `nastech-npm check [--json]` | Read the canonical npm Release channel without changing files |
| `nastech-npm update` | Install the checked exact npm version or reset the current runtime to its packaged Release |
| `nastech-npm methods [--json]` | List supported installation/ownership models for users and automation |
| `nastech-npm migrate upstream [--json]` | Show the one-way upstream handoff plan without changing files |
| `nastech-npm migrate upstream --yes` | Execute, verify, and finish the upstream handoff |
| `nastech-npm help [topic]` | Explain install, update, migration, or uninstall behavior |

## How installation works

`scripts/postinstall.js` performs the following without invoking a shell:

1. Validates the upstream repository, Release tag, and full commit SHA stored
   in `package.json`.
2. Requires Git and creates a shallow sparse checkout of the exact tag. The
   upstream `contributors/` metadata tree is omitted because it is not runtime
   input and can contain case-colliding paths that Windows and default macOS
   filesystems cannot represent independently.
3. Verifies that the fetched tag resolves to the committed SHA before checkout.
4. Downloads the pinned Astral `uv` asset for the current OS, architecture, and
   Linux libc variant.
5. Verifies the `uv` archive against a SHA-256 digest committed in
   `lib/uv-installer.js` and extracts only the executable.
6. Creates an `uv`-managed Python installation at the version pinned in the npm
   package metadata and `venv/` inside the upstream checkout.
7. Runs `uv sync --frozen --extra all --no-dev` using upstream project
   configuration and `uv.lock`.
8. Deletes the temporary dependency cache and writes a runtime marker.

`NASTECH_NIX_BUILD` is not enabled. It is not an installation or update endpoint
for this pinned upstream Release and would not provide npm ownership,
cross-platform Python provisioning, or a native-update checkout. The bridge
therefore uses the locked editable source synchronization path directly.

The launcher executes the real console scripts generated in the isolated venv:

```text
Windows:       runtime/nastech-agent/venv/Scripts/nastech.exe
macOS/Linux:   runtime/nastech-agent/venv/bin/nastech
```

Arguments, current working directory, standard streams, exit code, and native
upstream update handling are preserved.

## Runtime layout and isolation

```text
nastech-agent/
├── .nastech-agent-runtime.json
├── .uv_bin/                     # checksum-pinned uv
├── runtime/
│   ├── python/                  # uv-managed Python
│   └── nastech-agent/
│       ├── .git/                # native update checkout
│       ├── venv/                # isolated dependencies and entrypoints
│       └── ...                  # upstream source and assets
├── bin/                         # npm command shims
├── lib/                         # bridge code
└── package.json                 # release tag and commit pin
```

The npm installer does not modify system Python, Git configuration, shell
profiles, or global `PATH` beyond npm's normal binary shims. It does not change
`NASTECH_HOME`; upstream user configuration and state therefore retain their
normal location and survive npm reinstall/uninstall.

The package-local checkout is mutable by design because native updates are
enabled. Its sparse-checkout configuration remains active during native Git
updates; executable source and assets remain tracked normally, while only
`contributors/` stays absent. Removing the npm package removes this runtime,
but it does not remove upstream user data.

The explicit upstream handoff is the exception to the package-local boundary:
the pinned official installer creates the official checkout and may update
user PATH and managed prerequisites according to upstream behavior. It is
never run by `npm install` and requires `--yes`.

## Release automation

The publish workflow polls once per hour and also supports manual
`workflow_dispatch`. Its prepare job reads the latest non-draft,
non-prerelease upstream GitHub Release once and then:

1. resolves annotated tags to their final commit SHA;
2. reads `project.version` from `pyproject.toml` at that exact commit, or uses
   the semantic Release tag when upstream leaves `project.version` at `0.0.0`;
3. passes the validated tag, commit, version, and description to smoke and
   publish jobs for deterministic offline metadata application;
4. refuses to reuse an npm version if its published tag/commit mapping differs;
5. runs wrapper tests, a native `nastech update --check`, and full runtime smoke
   tests on Windows, macOS, and Linux;
6. publishes through npm trusted publishing with provenance.

Polling follows GitHub Releases, not PyPI and not the tip of `main`. Native
`nastech update` remains independent and may advance between Releases.

## Security and privacy

- [SECURITY.md](SECURITY.md) documents lifecycle-script behavior, trust
  boundaries, reporting, and the reduced attestation boundary after native
  updates.
- [PRIVACY.md](PRIVACY.md) documents installation and runtime network activity.
- [DISCLAIMER.md](DISCLAIMER.md) and [NOTICE](NOTICE) identify the unofficial
  relationship with upstream.

The bridge itself does not collect telemetry. Runtime providers and tools used
by upstream Nastech Agent have their own behavior and policies.

Audit without running lifecycle scripts:

```bash
npm pack nastech-agent
npm install --ignore-scripts ./nastech-agent-*.tgz
```

After review:

```bash
npm rebuild nastech-agent
```

Use `npm rebuild --global nastech-agent` for a global installation.

## Troubleshooting

### Git is required

```text
Git is required for the native 'nastech update' channel
```

Install Git, confirm `git --version`, and run:

```bash
npm rebuild nastech-agent
```

### Runtime is not ready

If installation was performed with `--ignore-scripts`, provision it explicitly:

```bash
npm rebuild nastech-agent
```

### Native and npm versions differ

This is expected after `nastech update`. Inspect both identities with:

```bash
nastech-npm status
```

Use `nastech-npm update` to return to a published Release.

### npm update cannot replace files

Stop running agents, gateways, desktop processes, and terminals using the
package runtime, then retry the npm update.

### `nastech uninstall` broke an npm installation

Rebuild or reinstall the npm package:

```bash
npm rebuild nastech-agent
# or
npm install --global nastech-agent@latest
```

Use npm, not the upstream uninstaller, to remove an npm-owned deployment.

### Upstream handoff is refused

Read the reported path or Git-origin conflict instead of forcing replacement.
If the only issue is a native-updated npm checkout, return it to the packaged
Release and inspect the plan again:

```bash
nastech-npm update
nastech-npm migrate upstream
```

## Development

```bash
npm test
npm pack --dry-run
npm run build:alias
```

The full local integration test downloads a managed Python runtime and upstream
dependencies:

```bash
npm run postinstall
npm run smoke
```

Release metadata can be refreshed with Python 3.11 or newer:

```bash
python scripts/sync_upstream_version.py
```

Do not publish solely because `main` changed. npm releases are synchronized
only from official upstream GitHub Releases.

## Legal and attribution

- Wrapper license: [MIT](LICENSE)
- Upstream attribution: [NOTICE](NOTICE)
- Unofficial-package notice: [DISCLAIMER.md](DISCLAIMER.md)
- Privacy notes: [PRIVACY.md](PRIVACY.md)

Bridge issues: https://github.com/nastechresearch/nastech-agent-npm/issues

Upstream issues: https://github.com/NastechResearch/nastech-agent/issues
