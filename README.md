# hermes-agent npm bridge

[![npm version](https://img.shields.io/npm/v/hermes-agent?logo=npm)](https://www.npmjs.com/package/hermes-agent)
[![npm downloads](https://img.shields.io/npm/dm/hermes-agent?logo=npm)](https://www.npmjs.com/package/hermes-agent)
[![CI](https://github.com/wyrtensi/hermes-agent-npm/actions/workflows/ci.yml/badge.svg)](https://github.com/wyrtensi/hermes-agent-npm/actions/workflows/ci.yml)
[![Upstream release](https://img.shields.io/github/v/release/NousResearch/hermes-agent?label=upstream&logo=github)](https://github.com/NousResearch/hermes-agent/releases)
[![Node.js 20+](https://img.shields.io/badge/Node.js-20%2B-339933?logo=nodedotjs&logoColor=white)](https://nodejs.org/)
[![npm provenance](https://img.shields.io/badge/npm%20provenance-enabled-brightgreen)](https://docs.npmjs.com/generating-provenance-statements)
[![Telegram chat](https://img.shields.io/badge/Telegram-chat-26A5E4?logo=telegram&logoColor=white)](https://t.me/+AoFg5hgLSlIyYTAy)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

## Important recent changes

- **npm 12 skips the install script.** npm 12 blocks dependency install
  scripts by default, so a plain install leaves `hermes` without its runtime.
  Starting with the first npm release after `0.22.2`, the first `hermes`
  launch provisions the runtime itself, and `hermes-npm setup` does it ahead
  of time. On `0.22.2` and earlier, install with
  `npm install --global --allow-scripts=hermes-agent hermes-agent`.
  See [npm 12 and install scripts](#npm-12-and-install-scripts).
- **Run `hermes-npm setup` before background use.** Run it once before you
  register `hermes` with an MCP client or a gateway service, so the first
  background launch does not spend 1-2 minutes on setup and hit a startup
  timeout.
- **`hermes update` follows upstream `stable` by default.** Unconfigured
  checkouts track the latest GitHub Release. The rolling `main` branch is
  opt-in through `hermes update --set-channel main`. See
  [Two update channels](#two-update-channels).
- **A native `hermes update` hands dependencies to upstream.** Upstream's
  package manager then keeps its environment under `HERMES_HOME/installs` and
  its launchers in `~/.local/bin` (or `HERMES_HOME\bin` on Windows).
  `hermes-npm status` shows who owns the dependencies. An npm reinstall or a
  same-version `hermes-npm update` takes them back. See
  [Native upstream channel](#native-upstream-channel).
- **The runtime uses Python 3.14** since `0.21.6`, matching upstream. See
  [Python 3.14 in release 0.21.6](#python-314-in-release-0216).

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

- [Important recent changes](#important-recent-changes)
- [Choose an installation method](#choose-an-installation-method)
- [Migration from pre-0.20](#migration-from-pre-020)
- [Install](#install)
- [npm 12 and install scripts](#npm-12-and-install-scripts)
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
| npm-isolated (recommended for npm users) | Global: `npm install --global hermes-agent`; project: `npm install hermes-agent` ([npm 12](#npm-12-and-install-scripts)) | Inside the npm package | `hermes-npm update` or `hermes update` | Matching global/project `npm uninstall` |
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
- `hermes update` remains the native upstream updater;
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

If npm skipped the install script (npm 12 does by default, as does
`--ignore-scripts`), the first `hermes` or `hermes-agent` launch performs the
same provisioning before starting Hermes, or you can run it explicitly:

```bash
hermes-npm setup
```

> [!WARNING]
> Stop running Hermes gateways and agents before an npm reinstall or npm-channel
> update. npm may replace the package-local checkout and virtual environment.

> [!CAUTION]
> While npm owns the deployment, do not run `hermes uninstall`. The upstream
> uninstaller operates on the checkout containing the running Python code and
> can delete the package-local runtime without removing the npm package. Use
> `npm uninstall hermes-agent` or `npm uninstall --global hermes-agent`.

## npm 12 and install scripts

npm 12 blocks dependency install scripts by default. A plain
`npm install --global hermes-agent` then installs only the command shims and
prints `install scripts blocked`. The bridge handles this itself: the first
`hermes` (or `hermes-agent`, or `npx hermes`) launch runs the package's own
installer, prints a one-line note to stderr, and continues once the runtime is
ready. This is a one-time download that usually takes 1-2 minutes; concurrent
first launches wait for a single setup. You can also provision ahead of time:

```bash
hermes-npm setup
```

> [!IMPORTANT]
> Run `hermes-npm setup` once before you register `hermes` with an MCP client,
> a gateway service, or any other program that starts it in the background.
> Otherwise the first background launch spends 1-2 minutes on setup before
> Hermes writes anything to stdout, and the client may give up on a startup
> timeout. Do the same after any `npm install` or `npm update` that replaced
> the package without running its install script; `hermes-npm update` already
> provisions the new release before it returns.

To let npm run the install script as on npm 11 and earlier:

```bash
# global, once
npm install --global --allow-scripts=hermes-agent hermes-agent

# global, every future install
npm config set allow-scripts=hermes-agent --location=user
```

For a project dependency, npm 12 rejects `--allow-scripts` and records the
approval in `package.json` instead:

```bash
npm install hermes-agent
npm install-scripts approve hermes-agent
npm rebuild hermes-agent
```

By default `approve` pins the entry to the installed version
(`"allowScripts": {"hermes-agent@<version>": true}`), so every version bump
needs a new approval. `npm install-scripts approve --no-allow-scripts-pin hermes-agent`
writes a name-only entry instead. Without any approval, `hermes-npm setup` or
the first launch provisions the runtime.

`hermes-npm update` does not depend on npm running the script either: after
npm installs the checked release, it runs the new package's installer directly
when the runtime is missing. On npm 11 and earlier nothing changes, because
npm has already provisioned the runtime by then.

Set `HERMES_NPM_AUTO_SETUP=0` to turn off provisioning on launch; `hermes` then
exits with an error that points to `hermes-npm setup`.

## Two update channels

The bridge intentionally exposes two independent update channels.

| Channel | Command | Source | Result |
| --- | --- | --- | --- |
| npm Release | `hermes-npm update` | Latest published `hermes-agent` npm version | Returns to the latest GitHub Release pinned by npm |
| Native upstream | `hermes update` | Upstream `stable` channel by default: the latest GitHub Release, forward only | Runs the unmodified upstream updater |
| Native rolling (opt-in) | `hermes update --set-channel main`, then `hermes update` | Upstream `main` branch | Runs the unmodified upstream updater on the rolling branch |

### Native upstream channel

```bash
hermes update --check
hermes update
```

These arguments are passed directly to the official upstream console
entrypoint. The bridge does not replace `cmd_update`, set `HERMES_MANAGED`, or
translate the command into npm operations.

Since upstream `v0.21.6`, an official checkout with no configured channel
tracks `stable`: `hermes update --check` prints `Update channel: stable`, and
`hermes update` moves only forward to the latest upstream GitHub Release. The
package-local checkout counts as such a checkout. The rolling `main` branch is
opt-in through `hermes update --set-channel main` (`--set-channel stable`
returns). Because the bridge publishes each upstream Release to npm, the
native stable channel usually reaches a new Release before `hermes-npm update`
does, and lands on the same commit.

After a native update, the source checkout can be newer than the npm package
version, and on the `main` channel newer than the latest upstream GitHub
Release. This is expected. npm integrity and provenance still cover the bridge
package, but no longer attest to source subsequently fetched by the native
updater.

The upstream updater also manages its own tools and environments according to
upstream behavior. In upstream `v0.22.x` it unshallows the package-local Git
checkout, builds a new dependency environment with its own managed Python and
`uv` under `HERMES_HOME/installs` and `HERMES_HOME/tools`, writes an
`install-stamp.json` into the checkout, and can publish `hermes` launchers
outside npm: `~/.local/bin` on macOS and Linux, and `HERMES_HOME\bin` added to
the user `PATH` on Windows. These are outside the npm release-pinned boundary
and are the explicit tradeoff for keeping native update behavior unchanged.

After a native update, upstream owns the dependency environment and the
launchers:

- Upstream records the environment it built under
  `HERMES_HOME/installs/<key>`, where the key is derived from the checkout
  path, marks the checkout as self-managed with an untracked
  `install-stamp.json`, and selects that environment at startup instead of the
  package's own `venv`. `hermes-npm status` reports this as
  `dependencies: upstream package manager` (`dependenciesOwner: "upstream-pm"`
  in `--json`, with the selected environment in `dependencyEnvironment`) and
  does not report the `npm-release` channel. The record lives in
  `~/.hermes/installs` (`%LOCALAPPDATA%\hermes\installs` on Windows) unless
  `HERMES_HOME` points outside that directory, in which case it lives in
  `HERMES_HOME/installs` (or `<root>/installs` for a `<root>/profiles/<name>`
  home); `<key>` is the first 16 hex digits of the SHA-256 of the
  `runtime source` path that `hermes-npm status` prints.
- npm takes the dependencies back whenever the bridge puts the checkout back
  on the commit pinned by the npm package: after `npm install` replaces the
  package (or `hermes-npm update` installs a newer one) and provisions a fresh
  checkout, and when a same-version `hermes-npm update` resets the checkout in
  place. The installer then removes that `installs/<key>` directory and the
  checkout's `install-stamp.json`, prints what it removed, and upstream falls
  back to the package `venv`. Nothing else under `HERMES_HOME` is touched, so
  upstream's shared tools under `HERMES_HOME/tools` and all user data stay.
  `hermes-npm setup` and `npm rebuild` for the same version keep the existing
  checkout and therefore keep a native update, dependencies included. The
  installer uses the `HERMES_HOME` of the shell it runs in; run it with the
  same `HERMES_HOME` as `hermes update`.
- The launchers upstream publishes in `~/.local/bin` execute files inside the
  npm package (`runtime/hermes-agent/.hermes/bin`). They stop working once npm
  reinstalls or removes the package; if `~/.local/bin` comes before the npm
  prefix in `PATH`, `hermes` then fails instead of reaching the npm shim.
  Remove those three files (`hermes`, `hermes-agent`, `hermes-acp`) if they
  point into the npm package. Setting `cli.expose_on_path: false` in
  `HERMES_HOME/config.yaml` stops upstream from publishing them on macOS and
  Linux; it has no effect on Windows, where upstream publishes its launchers
  in the `bin` directory it adds to the user `PATH`.

To return fully to npm ownership after a native update, run `hermes-npm update`
or reinstall the package, and remove those launchers yourself; the bridge does
not remove files outside the npm package other than that `installs/<key>`
directory. User configuration, sessions, and skills elsewhere in `HERMES_HOME`
are not affected.

### npm Release channel

Inspect the local relationship between npm and the live checkout:

```bash
hermes-npm status
hermes-npm status --json
```

`runtimeChannel` is `npm-release` only when the checkout is clean at the commit
pinned by the npm package and npm owns its dependencies. It is
`upstream-native` when the source has moved, when upstream's package manager
has recorded a dependency environment for the checkout
(`dependenciesOwner: "upstream-pm"`, read from
`<root>/installs/<key>/facts.json` exactly where upstream looks), or when the
checkout carries an untracked `install-stamp.json` with
`updateMechanism: "self"` (`upstreamSelfManagedStamp`), which hands it to
upstream's package manager on its next launch. `hermes-npm status` reads only
the record for the active Hermes root, the one upstream itself selects first.

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

An npm update intentionally replaces source moved by a native update with
the exact checkout pinned by the npm Release. If npm is already at the latest version but
the live checkout has moved, or upstream's package manager owns its
dependencies, `hermes-npm update` directly reprovisions that same release
commit. This discards tracked source changes in the package-local checkout and
returns dependency selection to the package `venv` as described under
[Native upstream channel](#native-upstream-channel); upstream user
configuration under `HERMES_HOME` is unaffected.
Running `hermes-npm setup` (or `npm rebuild`) for the same package version
instead preserves an existing native-updated checkout and only resynchronizes its
environment.

### Python 3.14 in release 0.21.6

Upstream `v0.21.6` locks dependencies for Python 3.14. The corresponding npm
release downloads a managed Python 3.14 runtime with `uv`; a system Python 3.14
installation is not required.

If an existing npm installation uses Python 3.11, run `hermes-npm update` after
`hermes-agent@0.21.6` is published. Updating the npm package replaces its
package-local checkout and venv, then creates a new Python 3.14 venv from the
upstream lockfile. Configuration, credentials, sessions, and other data under
`HERMES_HOME` remain in place. Rebuilding the old npm version does not perform
this transition.

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
7. re-runs the release's official command publication stage from the new checkout,
   so a global npm uninstall cannot delete an official launcher when
   both installations use the same bin directory.

Configuration, credentials, sessions, memories, skills, and other user state
under `HERMES_HOME` are preserved. The command refuses a non-Git target, a Git
target with an unexpected origin or uncommitted files, a `HERMES_HOME` inside
the npm package, or a runtime that has moved off its packaged Release. Run
`hermes-npm update` first if native update changes need to be reset before
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
| `hermes-npm setup` | Install or repair the isolated runtime of the installed npm version (alias: `provision`) |
| `hermes-npm methods [--json]` | List supported installation/ownership models for users and automation |
| `hermes-npm migrate upstream [--json]` | Show the one-way upstream handoff plan without changing files |
| `hermes-npm migrate upstream --yes` | Execute, verify, and finish the upstream handoff |
| `hermes-npm help [topic]` | Explain install, update, migration, or uninstall behavior |

## How installation works

`scripts/postinstall.js` performs the following without invoking a shell. npm
runs it as the package install script; when npm skips that script, the first
launch, `hermes-npm setup`, and `hermes-npm update` run the same file directly
with the current Node.js under a lock file in the package directory.

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
upstream update handling are preserved. When the console script is missing,
the launcher provisions the runtime first and sends that output to stderr, so
the command's stdout stays clean.

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
`hermes update` remains independent; it follows Releases by default and the
`main` branch only after `hermes update --set-channel main`.

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
hermes-npm setup
```

`npm rebuild hermes-agent` (`npm rebuild --global hermes-agent` for a global
installation) does the same on npm 11 and earlier, and on npm 12 once the
install script is allowed. Running `hermes` before the review also provisions
the runtime; set `HERMES_NPM_AUTO_SETUP=0` while auditing to prevent that.

## Troubleshooting

### Git is required

```text
Git is required for the native 'hermes update' channel
```

Install Git, confirm `git --version`, and run:

```bash
hermes-npm setup
```

### Runtime is not ready

If npm skipped the install script (npm 12 by default, or `--ignore-scripts`),
the first `hermes` launch provisions the runtime. If that failed or was
disabled with `HERMES_NPM_AUTO_SETUP=0`, provision it explicitly:

```bash
hermes-npm setup
```

For a root-owned global npm prefix, run it with the same privileges used for
`npm install --global`.

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

Re-provision or reinstall the npm package:

```bash
hermes-npm setup
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
