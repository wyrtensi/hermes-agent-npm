# Privacy

This npm bridge does not collect telemetry and does not operate an analytics
endpoint.

It does not intentionally collect, store, or upload personal information,
credentials, npm tokens, API keys, repository contents, or shell history.

## Installation network activity

During `npm install`, the bridge may contact:

- GitHub to fetch the exact upstream Git tag and commit recorded in
  `package.json`;
- GitHub to download the pinned Astral `uv` release asset;
- Astral-managed Python distribution endpoints used by `uv`;
- Python indexes and artifact hosts referenced by upstream project
  configuration and `uv.lock`.

These services receive normal request metadata such as IP address, requested
resource, TLS metadata, and user agent. The bridge adds no analytics identifier.

The temporary dependency cache is stored inside the npm package runtime and is
deleted after the installation attempt. The Git checkout, managed Python, and
venv remain until npm replaces or removes the package.

## Update network activity

`nastech-npm check` contacts `https://registry.npmjs.org` to read the `latest`
dist-tag. When an update is approved, `nastech-npm update` installs that exact
checked version from the same registry. npm can still use applicable proxy, CA,
authentication, and credential configuration.

`nastech update` is the unmodified upstream rolling updater. Its GitHub,
dependency, backup, gateway, and managed-tool behavior belongs to upstream
Nastech Agent rather than this bridge. Current upstream code may create a
managed `uv` under `NASTECH_HOME/bin` (normally `~/.nastech/bin`) while updating.

## Upstream handoff network activity

`nastech-npm migrate upstream` only prints a plan. With `--yes`, the bridge runs
the official installer stored in its verified Release checkout. That installer
may contact GitHub, Astral/Python distribution services, Python package
indexes, npm/Node distribution services, and browser/tool artifact hosts used
by upstream. Interactive setup, gateway startup, and Desktop building are
disabled, but upstream may still install managed prerequisites and seed files
under `NASTECH_HOME`.

The handoff preserves existing user state and does not copy it to a bridge
service. After successful verification it runs npm uninstall for the detected
scope. Subsequent runtime network behavior belongs to the upstream-managed
installation.

## Runtime boundary

The `nastech` and `nastech-agent` commands execute upstream Nastech Agent. Model
providers, tools, integrations, credentials, telemetry choices, and network
calls configured there are governed by upstream software and third-party
services selected by the user.

Upstream source: https://github.com/NastechResearch/nastech-agent

## Auditing without lifecycle execution

```bash
npm pack nastech-agent
npm install --ignore-scripts ./nastech-agent-*.tgz
```

After review, provision the runtime with `npm rebuild nastech-agent`, or use
`npm rebuild --global nastech-agent` for a global installation.
