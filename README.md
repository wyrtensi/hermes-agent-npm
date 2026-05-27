# hermes-agent npm bridge

This is an unofficial npm bridge for Hermes Agent by Nous Research. It is not
affiliated with, endorsed by, sponsored by, or maintained by Nous Research.

Hermes Agent is developed by Nous Research and distributed separately as a
Python package. This npm package only installs and launches that upstream Python
runtime.

This repository publishes the npm bridge for
[NousResearch/Hermes-Agent](https://github.com/NousResearch/Hermes-Agent).

The npm package name is:

```bash
hermes-agent
```

This repository can build an alias package manifest for:

```bash
hermesagent
```

npm currently blocks publishing the unscoped `hermesagent` package because the
name is too similar to the existing `hermes-agent` package. The available npm
alternative is a scoped package such as `@wyrtensi/hermesagent`.

The installed commands are:

```bash
hermes
hermes-agent
```

The npm package name `hermes` is already owned by another package on npm, so this
repository publishes `hermes-agent` and exposes `hermes` as a CLI binary.

## Legal and attribution

- Wrapper license: MIT, see [LICENSE](LICENSE).
- Upstream attribution: see [NOTICE](NOTICE).
- Unofficial package disclaimer: see [DISCLAIMER.md](DISCLAIMER.md).
- Privacy notes: see [PRIVACY.md](PRIVACY.md).
- Install-script security notes: see [SECURITY.md](SECURITY.md).

For wrapper issues, use this repository:

https://github.com/wyrtensi/hermes-agent-npm/issues

For upstream Hermes Agent issues, use the upstream project:

https://github.com/NousResearch/hermes-agent/issues

## Install

Prerequisites:

- Node.js 20 or newer
- Python 3.11 or newer
- pip available for that Python installation

Install globally:

```bash
npm install -g hermes-agent
```

Use it:

```bash
hermes --help
hermes-agent --help
```

If a scoped alias package is published later, you do not need to install both
`hermes-agent` and the alias. If one is already installed globally, the other
package prints a warning during `postinstall`.

During npm installation, `postinstall` installs the matching Python package:

```bash
python -m pip install --upgrade hermes-agent==<npm package version>
```

For a detailed explanation of why this package uses `postinstall` and exactly
what the script does, see [SECURITY.md](SECURITY.md).

## Automated publishing

`.github/workflows/npm-publish.yml` runs:

- manually with `workflow_dispatch`
- daily on a schedule
- when a tag matching `npm-v*` is pushed

The workflow:

1. Fetches the current Hermes Agent version from upstream `pyproject.toml`.
2. Updates `package.json` in the workflow workspace.
3. Skips publishing if `hermes-agent@<version>` already exists on npm.
4. Runs `npm test`.
5. Runs `npm pack --dry-run`.
6. Publishes missing npm packages with the `NPM_TOKEN` GitHub Actions secret.

## GitHub setup

Create a GitHub repository named:

```text
hermes-agent-npm
```

Create a classic or automation npm token with publish access, then add it as a
GitHub Actions secret:

```text
Repository -> Settings -> Secrets and variables -> Actions -> New repository secret
Name: NPM_TOKEN
Value: your npm token
```

After the first package version exists on npm, this repository can be switched
back to npm trusted publishing if desired:

```text
npm package: hermes-agent
publisher: GitHub Actions
organization or user: wyrtensi
repository: hermes-agent-npm
workflow filename: npm-publish.yml
allowed action: npm publish
```

Then push this repository:

```bash
git remote add origin git@github.com:wyrtensi/hermes-agent-npm.git
git push -u origin main
```

After that, open GitHub Actions and run `Publish npm package` manually for the
first publish.

## Local checks

```bash
python scripts/sync_upstream_version.py
npm test
npm pack --dry-run
npm run build:alias
npm pack --dry-run ./dist/hermesagent
```
