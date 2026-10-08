# hermes-agent npm bridge

[![npm version](https://img.shields.io/npm/v/hermes-agent?logo=npm)](https://www.npmjs.com/package/hermes-agent)
[![npm downloads](https://img.shields.io/npm/dm/hermes-agent?logo=npm)](https://www.npmjs.com/package/hermes-agent)
[![CI](https://github.com/wyrtensi/hermes-agent-npm/actions/workflows/ci.yml/badge.svg)](https://github.com/wyrtensi/hermes-agent-npm/actions/workflows/ci.yml)
[![Upstream release](https://img.shields.io/github/v/release/NousResearch/hermes-agent?label=upstream&logo=github)](https://github.com/NousResearch/hermes-agent/releases)
[![Node.js 20+](https://img.shields.io/badge/Node.js-20%2B-339933?logo=nodedotjs&logoColor=white)](https://nodejs.org/)
[![npm provenance](https://img.shields.io/badge/npm%20provenance-enabled-brightgreen)](https://docs.npmjs.com/generating-provenance-statements)
[![Telegram chat](https://img.shields.io/badge/Telegram-chat-26A5E4?logo=telegram&logoColor=white)](https://t.me/+AoFg5hgLSlIyYTAy)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

> [!IMPORTANT]
> **The deployment model changed in `0.20.0`.** Upstream Hermes Agent stopped
> publishing new PyPI releases. This bridge now creates a package-local Git
> checkout and an isolated Python runtime managed by `uv`. Existing users must
> reinstall the npm package. Python is no longer required on the host, but Git
> is required so the native `hermes update` command works consistently.

An unofficial npm bridge for [Hermes Agent](https://github.com/NousResearch/hermes-agent)
by Nous Research. It exposes the upstream `hermes` and `hermes-agent` commands
through npm. Normal npm installation does not execute the upstream shell or
PowerShell installers. An explicit, confirmed upstream handoff can run the
installer stored in the verified Release checkout.

This project is not affiliated with, endorsed by, sponsored by, or maintained
by Nous Research.

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

Choose one owner for the Hermes runtime. This table is intentionally near the
top so both people and repository-scanning agents see the deployment boundary
before copying an install command.

| Method | Install | Code and venv | Updates | Removal |
| --- | --- | --- | --- | --- |
| npm-isolated (recommended for npm users) | Global: `npm install --global hermes-agent`; project: `npm install hermes-agent` | Inside the npm package | `hermes update` or `hermes-npm update` | Matching global/project `npm uninstall` |
| upstream-managed | [Official upstream installer](https://github.com/NousResearch/hermes-agent#quick-install) or the handoff below | User-scoped `$HERMES_HOME/hermes-agent` | `hermes update` | `hermes uninstall` |
| manual development | [Upstream contributing guide](https://hermes-agent.nousresearch.com/docs/developer-guide/contributing) | Developer checkout with an external venv | Developer-managed Git and `uv` | Remove the selected checkout and venv |

Machine-readable discovery:

```bash
hermes-npm methods --json
hermes-npm status --json
```

Human-readable command help:

```bash
hermes-npm help install
hermes-npm help update
hermes-npm help migrate
hermes-npm help uninstall
```

The npm default remains package-local deliberately. A global and several
project-local npm installations can then pin independent runtimes and npm can
remove everything it owns. Making every npm package write to one shared
`HERMES_HOME/hermes-agent` would create cross-project version races and leave
files outside npm ownership.

For a new upstream-managed installation that has never been owned by npm, the
current official commands are:

```bash
# Linux, macOS, WSL2, Termux
curl -fsSL https://hermes-agent.nousresearch.com/install.sh | bash
```

```powershell
# Native Windows PowerShell
iex (irm https://hermes-agent.nousresearch.com/install.ps1)
```

Those commands execute the current upstream network endpoint and belong to the
upstream trust boundary. Existing npm users can instead use the handoff below,
which executes the installer already present in the bridge's verified Release
checkout and pins the same full commit.

## Migration from pre-0.20

Versions through `0.15.2` installed a pinned `hermes-agent` package into a host
Python environment. The upstream `hermes update` command then independently
checked and upgraded that Python package through PyPI. npm could report one
version while Python executed another.

That legacy code was normally stored in the selected Python environment's
global or user `site-packages`; it was not an official source checkout at
`$HERMES_HOME/hermes-agent`. User configuration and state did use the normal
upstream `HERMES_HOME`, as they still do now.

Starting with `0.20.0`:

- PyPI is not used to install Hermes Agent itself;
- `uv` downloads the isolated managed Python version pinned in the npm package
  metadata;
- upstream source is checked out at the exact GitHub Release tag and commit;
- dependencies are synchronized from upstream `uv.lock`;
- `hermes update` remains the native upstream rolling updater;
- `hermes-npm update` is the explicit npm Release updater.

Upgrade globally with:

```bash
npm install --global hermes-agent@latest
```

The bridge no longer searches for or launches a system Python. Any legacy
Python installation of Hermes Agent is independent and is not removed
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
npm install --global hermes-agent
hermes --help
```

Project installation:

```bash
npm install hermes-agent
npx hermes --help
```

The first install downloads Python and dependencies and can take several
minutes. A Windows test installation of `0.20.0` occupied about 450 MB after
the temporary dependency cache was removed; size varies by platform and future
upstream dependencies.

> [!WARNING]
> Stop running Hermes gateways and agents before an npm reinstall or npm-channel
> update. npm may replace the package-local checkout and virtual environment.

> [!CAUTION]
> While npm owns the deployment, do not run `hermes uninstall`. The upstream
> uninstaller operates on the checkout containing the running Python code and
> can delete the package-local runtime without removing the npm package. Use
> `npm uninstall hermes-agent` or `npm uninstall --global hermes-agent`.

## Two update channels

The bridge intentionally exposes two independent update channels.

| Channel | Command | Source | Result |
| --- | --- | --- | --- |
| Native rolling | `hermes update` | Upstream Git branch, normally `main` | Runs the unmodified upstream updater |
| npm Release | `hermes-npm update` | Latest published `hermes-agent` npm version | Returns to the latest GitHub Release pinned by npm |

### Native rolling channel

```bash
hermes update --check
hermes update
```

These arguments are passed directly to the official upstream console
entrypoint. The bridge does not replace `cmd_update`, set `HERMES_MANAGED`, or
translate the command into npm operations.

After a native update, the source checkout can be newer than both the npm
package version and the latest upstream GitHub Release. This is expected. npm
integrity and provenance still cover the bridge package, but no longer attest
to source subsequently fetched by the native updater.

The upstream updater may also install its own managed tools, dependencies, or
runtime files according to upstream behavior. In the current upstream release,
that includes a managed `uv` under `HERMES_HOME/bin` (normally `~/.hermes/bin`)
and may include checkout-local runtime-repair files. This is outside the npm
release-pinned boundary and is the explicit tradeoff for keeping native update
behavior unchanged.

### npm Release channel

Inspect the local relationship between npm and the live checkout:

```bash
hermes-npm status
hermes-npm status --json
```

Check the npm registry:

```bash
hermes-npm check
```

Return to or advance along the release-pinned channel:

```bash
hermes-npm update
```

When a newer npm version exists, `hermes-npm update` installs the exact version
returned by its check from the same canonical registry. It does not resolve the
mutable `latest` tag a second time. Depending on installation scope, the
effective command is equivalent to:

```bash
npm install --global --registry=https://registry.npmjs.org hermes-agent@<checked-version>
npm install --registry=https://registry.npmjs.org hermes-agent@<checked-version>
```

An npm update intentionally replaces native rolling changes with the exact
checkout pinned by the npm Release. If npm is already at the latest version but
the live checkout has moved, `hermes-npm update` directly reprovisions that
same release commit. This discards tracked source changes in the package-local
checkout; upstream user configuration under `HERMES_HOME` is unaffected.
Running `npm rebuild` for the same package version instead
preserves an existing native-updated checkout and only resynchronizes its
environment.

For automation and agents, `hermes-npm status --json` is the canonical
machine-readable note. Child processes also receive:

```text
HERMES_NPM_BRIDGE=1
HERMES_NPM_PACKAGE_ROOT=<package directory>
HERMES_NPM_PACKAGE_VERSION=<npm version>
HERMES_NPM_RELEASE_TAG=<upstream release tag>
```

The bridge deliberately does not set `HERMES_MANAGED`; upstream currently uses
that flag to prohibit configuration and setup changes in addition to updates.

## Move from npm to an upstream-managed install

Use a one-way handoff when you want the normal upstream source location, PATH
integration, native uninstaller, and `hermes update` as the sole update owner.
First inspect the exact plan; this makes no changes:

```bash
hermes-npm migrate upstream
hermes-npm migrate upstream --json
```

Stop running Hermes processes, then execute it explicitly:

```bash
hermes-npm migrate upstream --yes
```

The handoff:

1. requires the npm runtime to be at its exact Release-pinned commit;
2. uses `scripts/install.sh` or `scripts/install.ps1` from that already verified
   checkout rather than downloading a mutable installer endpoint;
3. passes the exact commit and uses non-interactive, skip-setup mode;
4. installs to the user-scoped `$HERMES_HOME/hermes-agent` target on macOS and
   Linux or `%LOCALAPPDATA%\hermes\hermes-agent` on Windows, unless
   `HERMES_HOME` is already set;
5. verifies the resulting Git commit and venv `hermes` executable;
6. only after successful verification, removes the npm package in its detected
   local or global scope;
7. re-runs the official installer's `products` stage from the new checkout,
   so a global npm uninstall cannot delete an official launcher when
   both installations use the same bin directory.

Configuration, credentials, sessions, memories, skills, and other user state
under `HERMES_HOME` are preserved. The command refuses a non-Git target, a Git
target with an unexpected origin or uncommitted files, a `HERMES_HOME` inside
the npm package, or a runtime that has moved off its packaged Release. Run
`hermes-npm update` first if native rolling changes need to be reset before
handoff. Existing upstream checkout changes must be committed, stashed, or
removed explicitly; the bridge never answers an upstream restore prompt.

This is not a side-by-side mode. Two active checkouts sharing the same command
names, PATH entries, gateway definitions, ports, tokens, and user state cannot
be given reliable ownership across Windows, macOS, and Linux. To return later,
uninstall the upstream deployment while preserving the desired user data, then
install the npm package again.

Run the handoff as the account that should own `HERMES_HOME`; do not add `sudo`
just because the existing global npm package is root-owned. If the final global
npm removal lacks permission, the verified upstream installation remains in
place and the command prints the exact npm removal command to run separately
with the permissions required by that npm prefix.

## Commands

```bash
hermes                 # primary upstream CLI
hermes-agent           # legacy/direct run_agent entrypoint
hermes-npm             # npm ownership, release channel, methods, and handoff
```

`hermes` should be preferred for normal use. `hermes-agent` preserves upstream
legacy behavior; notably, its Fire-based argument handling is not equivalent
to the main CLI, and `hermes-agent --help` may initialize the direct agent
instead of acting like `hermes --help`.

The npm package is named `hermes-agent`. The unscoped package name `hermes`
belongs to another project, so this package exposes `hermes` only as a binary.

The repository can also build an alias package named `hermesagent` for legacy
compatibility testing; it is not published by the automated release workflow.
Installing both names is unnecessary and creates two isolated runtimes. An
alias installation can check the canonical `hermes-agent` Release channel, but
it refuses to install the canonical package over the alias automatically.
Instead, it prints scope-appropriate commands that remove the alias first and
then install the exact checked canonical version.

### `hermes-npm` command reference

| Command | Effect |
| --- | --- |
| `hermes-npm status [--json]` | Report npm identity, exact live Git commit, channel, dirty state, and install scope |
| `hermes-npm check [--json]` | Read the canonical npm Release channel without changing files |
| `hermes-npm update` | Install the checked exact npm version or reset the current runtime to its packaged Release |
| `hermes-npm methods [--json]` | List supported installation/ownership models for users and automation |
| `hermes-npm migrate upstream [--json]` | Show the one-way upstream handoff plan without changing files |
| `hermes-npm migrate upstream --yes` | Execute, verify, and finish the upstream handoff |
| `hermes-npm help [topic]` | Explain install, update, migration, or uninstall behavior |

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

`HERMES_NIX_BUILD` is not enabled. It is not an installation or update endpoint
for this pinned upstream Release and would not provide npm ownership,
cross-platform Python provisioning, or a native-update checkout. The bridge
therefore uses the locked editable source synchronization path directly.

The launcher executes the real console scripts generated in the isolated venv:

```text
Windows:       runtime/hermes-agent/venv/Scripts/hermes.exe
macOS/Linux:   runtime/hermes-agent/venv/bin/hermes
```

Arguments, current working directory, standard streams, exit code, and native
upstream update handling are preserved.

## Runtime layout and isolation

```text
hermes-agent/
├── .hermes-agent-runtime.json
├── .uv_bin/                     # checksum-pinned uv
├── runtime/
│   ├── python/                  # uv-managed Python
│   └── hermes-agent/
│       ├── .git/                # native update checkout
│       ├── venv/                # isolated dependencies and entrypoints
│       └── ...                  # upstream source and assets
├── bin/                         # npm command shims
├── lib/                         # bridge code
└── package.json                 # release tag and commit pin
```

The npm installer does not modify system Python, Git configuration, shell
profiles, or global `PATH` beyond npm's normal binary shims. It does not change
`HERMES_HOME`; upstream user configuration and state therefore retain their
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
5. runs wrapper tests, a native `hermes update --check`, and full runtime smoke
   tests on Windows, macOS, and Linux;
6. publishes through npm trusted publishing with provenance.

Polling follows GitHub Releases, not PyPI and not the tip of `main`. Native
`hermes update` remains independent and may advance between Releases.

## Security and privacy

- [SECURITY.md](SECURITY.md) documents lifecycle-script behavior, trust
  boundaries, reporting, and the reduced attestation boundary after native
  updates.
- [PRIVACY.md](PRIVACY.md) documents installation and runtime network activity.
- [DISCLAIMER.md](DISCLAIMER.md) and [NOTICE](NOTICE) identify the unofficial
  relationship with upstream.

The bridge itself does not collect telemetry. Runtime providers and tools used
by upstream Hermes Agent have their own behavior and policies.

Audit without running lifecycle scripts:

```bash
npm pack hermes-agent
npm install --ignore-scripts ./hermes-agent-*.tgz
```

After review:

```bash
npm rebuild hermes-agent
```

Use `npm rebuild --global hermes-agent` for a global installation.

## Troubleshooting

### Git is required

```text
Git is required for the native 'hermes update' channel
```

Install Git, confirm `git --version`, and run:

```bash
npm rebuild hermes-agent
```

### Runtime is not ready

If installation was performed with `--ignore-scripts`, provision it explicitly:

```bash
npm rebuild hermes-agent
```

### Native and npm versions differ

This is expected after `hermes update`. Inspect both identities with:

```bash
hermes-npm status
```

Use `hermes-npm update` to return to a published Release.

### npm update cannot replace files

Stop running agents, gateways, desktop processes, and terminals using the
package runtime, then retry the npm update.

### `hermes uninstall` broke an npm installation

Rebuild or reinstall the npm package:

```bash
npm rebuild hermes-agent
# or
npm install --global hermes-agent@latest
```

Use npm, not the upstream uninstaller, to remove an npm-owned deployment.

### Upstream handoff is refused

Read the reported path or Git-origin conflict instead of forcing replacement.
If the only issue is a native-updated npm checkout, return it to the packaged
Release and inspect the plan again:

```bash
hermes-npm update
hermes-npm migrate upstream
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

Bridge issues: https://github.com/wyrtensi/hermes-agent-npm/issues

Upstream issues: https://github.com/NousResearch/hermes-agent/issues
