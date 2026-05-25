# hermes-agent npm package

This repository publishes the npm bridge for
[NousResearch/Hermes-Agent](https://github.com/NousResearch/Hermes-Agent).

The npm package name is:

```bash
hermes-agent
```

The installed commands are:

```bash
hermes
hermes-agent
```

The npm package name `hermes` is already owned by another package on npm, so this
repository publishes `hermes-agent` and exposes `hermes` as a CLI binary.

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

During npm installation, `postinstall` installs the matching Python package:

```bash
python -m pip install --upgrade hermes-agent==<npm package version>
```

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
6. Publishes to npm through npm trusted publishing with GitHub Actions OIDC.

## GitHub setup

Create a GitHub repository named:

```text
hermes-agent-npm
```

Configure npm trusted publishing for this package:

```text
npm package: hermes-agent
publisher: GitHub Actions
organization or user: wyrtensi
repository: hermes-agent-npm
allowed action: npm publish
```

No npm token is needed in GitHub Actions. The workflow uses GitHub's OIDC token
through `permissions: id-token: write`.

Path on npm:

```text
npmjs.com -> hermes-agent -> Settings -> Trusted Publisher
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
```
