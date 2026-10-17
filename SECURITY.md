
# Security policy

## Supported versions

Only the latest published `hermes-agent` npm release receives bridge security
updates.

| Version | Status | Deployment model |
| --- | --- | --- |
| Latest published `>=0.20.0` | Supported | Release-pinned Git checkout and package-local `uv`/Python runtime |
| Older `>=0.20.0` | Unsupported | Same deployment model without current bridge fixes |
| `<0.20.0` | Unsupported | Legacy system-Python and PyPI installation |

Security fixes in upstream Hermes Agent become available to this channel after
upstream publishes a GitHub Release and the matching npm bridge passes its
release checks. The native upstream updater can apply a Release sooner, and
upstream `main` commits when switched to the rolling channel, with the
different trust boundary described below.

## Reporting a vulnerability

Report vulnerabilities in this npm bridge through GitHub private vulnerability
reporting:

https://github.com/wyrtensi/hermes-agent-npm/security/advisories/new

Include the npm version, operating system and architecture, affected command or
lifecycle step, impact, and reproduction details. Do not open a public issue
for an untriaged vulnerability.

Report vulnerabilities in Hermes Agent runtime behavior to upstream:

https://github.com/NousResearch/hermes-agent/security

Use the public bridge issue tracker only for non-sensitive installation and
compatibility bugs:

https://github.com/wyrtensi/hermes-agent-npm/issues

## Security scope

This policy covers:

- the npm command shims and `hermes-npm` release-channel commands;
- the explicit `hermes-npm migrate upstream` handoff and its preflight checks;
- npm lifecycle provisioning in `scripts/postinstall.js`, including its
  direct execution on first launch, by `hermes-npm setup`, and by
  `hermes-npm update` when npm skipped the install script;
- `uv` asset selection, download, checksum verification, and extraction;
- GitHub Release metadata synchronization and npm publishing workflows;
- confinement of npm lifecycle installer-created files to the installed npm
  package.

The upstream agent, its tools and integrations, model providers, and actions a
user authorizes the agent to perform are separate trust domains.

## Security invariants

The bridge is intended to preserve these properties:

1. A missing package-local runtime never falls back to a system Python.
2. Installer subprocesses use executable/argument arrays and do not evaluate
   downloaded shell or PowerShell scripts.
3. The downloaded `uv` archive must match a SHA-256 digest committed in this
   repository before any executable is extracted.
4. Release installation fetches the recorded Git tag and verifies that it
   resolves to the full commit SHA recorded in `package.json`.
5. npm lifecycle installer deletion/replacement targets must resolve inside
   the npm package.
6. Python, the virtual environment, the Git checkout, and temporary caches
   created by npm lifecycle installation remain inside the npm package.
7. `hermes update` is passed to the upstream console entrypoint unchanged; the
   bridge does not falsely represent natively updated source as npm-attested source.
8. A release-channel reset returns tracked upstream source to the commit pinned
   by npm without deleting untracked files with `git clean`.
9. npm publication is blocked unless Windows, macOS, and Linux runtime smoke
   jobs succeed for the same upstream tag, commit, and version.
10. The upstream installer is never run during npm lifecycle provisioning.
    A handoff requires `migrate upstream --yes`, uses the script from the
    verified Release checkout, pins the same full commit, verifies the new
    checkout/venv, and removes npm ownership only after that verification.
11. When npm skips the install script, the bridge provisions only by running
    the installed package's own `scripts/postinstall.js` with the current
    Node.js, with the same verification and package-local boundary as the
    npm lifecycle. It never passes `--allow-scripts` to npm or changes npm
    configuration.

A change that violates one of these invariants is security-relevant even if no
exploit has yet been demonstrated.

## Why `postinstall` exists

Upstream stopped publishing new PyPI releases. The bridge therefore provisions
the runtime during npm installation so this remains sufficient:

```bash
npm install --global hermes-agent
```

Lifecycle scripts execute with the installing user's permissions. Review the
package before installation when that is not an acceptable trust decision; the
audit procedure below avoids lifecycle execution.

npm 12 blocks dependency install scripts by default, so `npm install` may leave
only the command shims. The same `scripts/postinstall.js` then runs when the
user first starts `hermes` or `hermes-agent`, runs `hermes-npm setup`, or
updates with `hermes-npm update`. It runs with the permissions of that user,
in the package directory, under a lock file
(`.hermes-agent-provision.lock`) that serializes concurrent first launches.
Starting a Hermes command is treated as consent to provision it; set
`HERMES_NPM_AUTO_SETUP=0` to require an explicit `hermes-npm setup` instead.
Allowing the script in npm (`--allow-scripts=hermes-agent` for global installs,
`npm install-scripts approve hermes-agent` for projects) restores provisioning
during installation.

## Exact install behavior

`scripts/postinstall.js` and `lib/uv-installer.js`:

1. validate the upstream repository, Release tag, and full commit SHA stored in
   `package.json`;
2. require Git and initialize a shallow package-local sparse checkout that
   omits only the non-runtime upstream `contributors/` metadata tree;
3. fetch the exact tag and verify its peeled commit before checkout;
4. select a pinned Astral `uv` asset for Windows, macOS, or Linux, including
   supported architecture and Linux libc variants;
5. enforce compressed and extracted size limits, verify SHA-256, and extract
   only `uv`/`uv.exe` with Node.js;
6. provision the managed Python version pinned in the package metadata
   (`hermesAgent.pythonVersion`, currently 3.14) under `runtime/python/`;
7. create `runtime/hermes-agent/venv/` and run
   `uv sync --frozen --extra all --no-dev` using upstream project configuration
   and `uv.lock`;
8. remove the temporary dependency cache and write a runtime identity marker.

The sparse boundary prevents case-colliding contributor metadata from making
Windows or default macOS checkouts dirty. It does not ignore or omit executable
runtime source; tracked changes outside `contributors/` still fail the clean
Release check.

The installer does not invoke an upstream installer script, a system package
manager, system Python/pip, `curl`, `tar`, PowerShell download evaluation, or
`HERMES_NIX_BUILD`.

This statement applies to npm lifecycle provisioning. The optional upstream
handoff described below intentionally invokes the official installer only
after an explicit command and confirmation.

## Update trust boundaries

The bridge deliberately provides two update channels.

### npm Release channel

`hermes-npm check` reads the npm `latest` dist-tag from the canonical public
registry. When a newer package exists, `hermes-npm update` installs the exact
version that was checked from that same registry; it does not perform a second
mutable `@latest` resolution. If the npm package is already current, the command
resets a clean natively updated checkout in place to the tag/commit pinned by the
installed npm version. A dirty or damaged checkout is replaced transactionally
with rollback where possible.

npm integrity and provenance cover the bridge tarball and its pinned Release
identity. They do not include dependencies downloaded during lifecycle
execution.

### Native upstream channel

`hermes update` and `hermes update --check` run the unmodified upstream updater.
Since upstream `v0.21.6`, an official checkout with no configured channel,
including the package-local one, follows upstream's `stable` channel: the
latest GitHub Release, forward only. `hermes update --set-channel main` opts
into the rolling `main` branch. The updater mutates the package-local checkout
(including unshallowing it), builds its own dependency environments and managed
tools under `HERMES_HOME`, writes `install-stamp.json` into the checkout, and
can publish launchers outside npm (`~/.local/bin` on macOS and Linux, a
`HERMES_HOME\bin` user `PATH` entry on Windows). After a native update, npm
provenance no longer attests to the live upstream source.

The dependency environment the native updater builds is recorded under
`HERMES_HOME/installs/`, keyed by the checkout path, and upstream selects it at
startup. Because an npm reinstall keeps that path, a later `hermes-npm update`
returns tracked source to the Release commit but does not return dependency
selection to the package's own `venv`; the bridge does not delete state under
`HERMES_HOME`, and `hermes-npm status` does not yet report this case. Launchers
published to `~/.local/bin` point into the npm package and break when npm
replaces or removes it. The README describes how to return to npm ownership.

Use `hermes-npm status --json` to distinguish `npm-release`, `upstream-native`,
and `missing` runtime states. Use `hermes-npm update` to return to the npm
Release boundary.

### Upstream-managed handoff

`hermes-npm migrate upstream` is a read-only plan. The `--yes` form transfers
ownership to an upstream-managed installation. It does not download or
evaluate the mutable installer endpoint: it runs `scripts/install.sh` or
`scripts/install.ps1` from the package's verified, Release-pinned checkout and
passes the same full commit with forced pinning, non-interactive mode, and
setup skipped.

Before execution the bridge requires an `npm-release` runtime, refuses an
external target that is not a Git checkout when it already exists, validates
an existing checkout's origin against the official upstream repository,
refuses a dirty target, and refuses `HERMES_HOME` inside the npm package. After
installation it verifies a clean exact Git HEAD and the platform venv console
executable. npm uninstall is
started only after these checks pass. The official installer's `path` stage is
then re-run from the verified external checkout, which repairs command links
if global npm removal shared their bin directory. If installation or
verification fails, the npm package remains the active owner.

The handoff is intentionally not side-by-side. The official installer may
write outside the npm package, manage `HERMES_HOME/bin`, user PATH, Python,
Node/browser prerequisites, configuration templates, and bundled skills. Its
behavior is upstream's trust domain after the user explicitly elects to leave
npm ownership. Interactive setup, gateway startup, and Desktop building are
disabled by the bridge invocation.

## Network and configuration boundaries

Installation may contact:

- GitHub for the pinned upstream tag/commit and pinned Astral `uv` asset;
- Astral-managed Python distribution endpoints used by `uv`;
- package indexes and artifact hosts referenced by upstream project
  configuration and `uv.lock`.

`hermes-npm check` and the update it authorizes are bound to
`https://registry.npmjs.org`; npm can still honor applicable proxy, CA, and
authentication settings. Git commands may honor user proxy, credential-helper,
and CA configuration. Git is run with terminal credential prompts disabled and
inherited `GIT_DIR`, `GIT_WORK_TREE`, and `GIT_INDEX_FILE` removed.

Bootstrap operations disable ambient `uv` configuration so Python and cache
locations remain package-local. Dependency synchronization intentionally uses
the checked-out upstream project's `uv` configuration and lockfile.

## Filesystem boundary

npm installation creates or modifies only these package-local locations:

```text
.hermes-agent-runtime.json
.uv_bin/
runtime/cache/
runtime/python/
runtime/hermes-agent/
```

Provisioning also creates the transient `.hermes-agent-provision.lock` while
it runs.

It does not modify system Python, shell profiles, the global `PATH` beyond
normal npm command shims, services, scheduled tasks, or Git configuration.

Running upstream Hermes is different from installing the bridge. Upstream may
write configuration, credentials, logs, backups, managed tools, and runtime
state under `HERMES_HOME` and may start user-requested gateways or integrations.
Uninstalling npm does not remove that user data.

Do not run upstream `hermes uninstall` while npm owns the runtime. Upstream
derives its project root from the running Python package, so in npm mode it can
remove the checkout inside `node_modules` without removing the npm package or
its marker. Use scope-appropriate `npm uninstall` instead. After a completed
handoff, upstream owns the checkout and its native uninstaller is appropriate.

For a project-local installation, `hermes-npm update` invokes `npm install` in
the owning project and may update its dependency manifest and lockfile according
to normal npm behavior.

## Publishing security

The publish workflow:

- polls the latest non-draft, non-prerelease upstream GitHub Release hourly;
- resolves annotated tags to their final commit and records the full SHA;
- refuses to overwrite an npm version whose published tag/commit identity
  differs;
- resolves Release identity once in the prepare job and passes that immutable
  identity to smoke and publish jobs without repeating mutable latest lookups;
- runs unit, package, native-update-check, and full runtime smoke tests on
  Windows, macOS, and Linux;
- pins third-party GitHub Actions by commit SHA;
- grants `id-token: write` only to the publish job;
- publishes through npm trusted publishing with provenance and no long-lived
  npm token in the workflow.

Repository and npm settings should continue to protect the default branch,
require review of workflow and checksum changes, require 2FA for maintainers,
and disallow legacy publish tokens after trusted publishing is configured.

## Severity guidance

Examples of bridge findings that should be reported privately include:

- **Critical:** bypass of publish identity/provenance controls, or remote code
  execution before pinned artifact/commit verification;
- **High:** command injection, installer path escape or arbitrary overwrite,
  checksum/tag-to-commit verification bypass, or credential exfiltration;
- **Medium:** a reliable integrity downgrade, unsafe update-channel confusion,
  or proxy/configuration handling that redirects executable content contrary to
  documented verification;
- **Low:** hardening gaps with limited impact, such as avoidable information
  disclosure or denial of service requiring local access.

Final severity depends on reachability, required privileges, user interaction,
and impact; these examples are not automatic ratings.

## Accepted risks and limitations

- npm lifecycle execution downloads and executes a verified `uv` binary and
  installs code selected by the upstream lockfile. `--ignore-scripts` is the
  supported opt-out.
- The upstream repository, GitHub Release/tag administration, Astral release
  process, Python artifact indexes, npm, GitHub Actions, and applicable local
  Git/npm proxy, CA, credential, and authentication configuration remain
  supply-chain trust dependencies.
- The commit pin prevents tag retargeting from silently changing a published
  npm version, but this bridge does not independently verify a Git tag's GPG or
  SSH signature.
- Native updates are upstream's trust domain: by default they move the
  checkout to the latest upstream Release before the bridge has published and
  smoke-tested it, on the opt-in `main` channel they follow a mutable branch
  beyond reviewed Releases, and they create files outside the npm package.
- Host compromise, malicious npm/Git configuration, or write access to the
  installed package can invalidate local guarantees.
- Only the latest npm bridge release is maintained; users must update to
  receive bridge fixes.
- Windows can prevent replacement while Hermes processes hold runtime files;
  users should stop agents, gateways, and desktop processes before npm-channel
  replacement.
- The optional handoff expands the filesystem and tool-management boundary to
  the official upstream installer. A failure after official verification but
  during npm uninstall can temporarily leave both deployments present; remove
  the npm package with the exact command shown in the handoff plan.

## Out of scope

- vulnerabilities solely in upstream Hermes Agent, its bundled skills, or its
  third-party dependencies, unless the bridge introduces or amplifies them;
- model-provider behavior, prompt injection against an intentionally running
  agent, and actions explicitly authorized through upstream tools;
- vulnerabilities in npm, GitHub, Git, Astral infrastructure, Python package
  indexes, or the operating system itself;
- unsupported bridge versions and manually modified or forked runtime source.

Reports that reveal a bridge-specific exploit path through an otherwise
out-of-scope component are still welcome.

## Auditing before installation

Fetch and unpack without running lifecycle scripts:

```bash
npm pack hermes-agent
npm install --ignore-scripts ./hermes-agent-*.tgz
```

Review at minimum:

```text
package/package.json
package/scripts/postinstall.js
package/lib/uv-installer.js
package/lib/python-launcher.js
package/lib/npm-channel.js
package/lib/upstream-migration.js
```

Compare `hermesAgent.upstreamGitTag` and `hermesAgent.upstreamCommit` with the
official upstream Release. Starting `hermes` provisions the runtime, so keep
`HERMES_NPM_AUTO_SETUP=0` set until the review is done. After review, provision
with:

```bash
hermes-npm setup
```

`npm rebuild hermes-agent` (or `npm rebuild --global hermes-agent`) is
equivalent on npm 11 and earlier, and on npm 12 once the install script is
allowed.

Security scanners are expected to flag the lifecycle script. Treat that as a
prompt to review the explicit download, verification, and execution boundary,
not as proof that the lifecycle step is safe or malicious by itself.
