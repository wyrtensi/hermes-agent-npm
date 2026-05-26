# Security notes for the npm postinstall script

This package intentionally includes a `postinstall` script:

```json
{
  "scripts": {
    "postinstall": "node scripts/postinstall.js"
  }
}
```

Install scripts deserve careful review because they execute automatically during
`npm install`. This document explains exactly why this package has one, what it
does, and what it does not do.

## Why postinstall exists

`hermes-agent` on npm is a small Node.js bridge for the upstream Python project:

https://github.com/NousResearch/Hermes-Agent

The actual Hermes Agent runtime is distributed as the Python package
`hermes-agent`. The npm package provides convenient global commands:

```bash
hermes
hermes-agent
hermesagent
```

The canonical npm package is `hermes-agent`. The package `hermesagent` is an
alias manifest for users who search for the name without the hyphen. npm blocks
publishing the unscoped `hermesagent` package because the name is too similar to
`hermes-agent`; a scoped alias such as `@wyrtensi/hermesagent` can be published
separately if needed.

The `postinstall` step installs the matching Python package version so that a
single command prepares the npm wrapper and the Python runtime:

```bash
npm install -g hermes-agent
```

Without `postinstall`, users would need to run a second command manually:

```bash
python -m pip install --upgrade hermes-agent==<npm package version>
```

## Exact behavior

The script is located at:

```text
scripts/postinstall.js
```

It performs these steps:

1. Finds an available Python 3 interpreter.
   - On Windows it tries `py -3`, then `python`, then `python3`.
   - On macOS and Linux it tries `python3`, then `python`.
2. Verifies that the interpreter is Python 3.11 or newer.
3. Builds the pinned Python package spec from `package.json`, for example:

   ```bash
   hermes-agent==0.14.0
   ```

4. Runs:

   ```bash
   python -m pip install --upgrade hermes-agent==0.14.0
   ```

5. If that install fails, retries with:

   ```bash
   python -m pip install --upgrade --user hermes-agent==0.14.0
   ```

6. Exits with a non-zero status if both attempts fail.

The script also checks whether the related alias package is already installed
globally. If `hermes-agent` is installed and a user installs `hermesagent`, or
the other way around, it prints a warning explaining that both packages point to
the same Hermes Agent runtime. It does not uninstall packages or modify npm
global state.

## What the script does not do

The `postinstall` script does not:

- read SSH keys, npm tokens, GitHub tokens, or other secrets
- inspect project source files outside this npm package
- upload telemetry or analytics
- call custom remote shell scripts
- run `curl | sh`, PowerShell downloads, or arbitrary downloaded code
- modify shell profiles such as `.bashrc`, `.zshrc`, or PowerShell profiles
- add startup items, services, scheduled tasks, or background daemons
- change Git configuration
- install npm packages dynamically

Its network activity is limited to the normal package downloads performed by
`pip` from the user's configured Python package index.

## Why the package is version-pinned

The npm package version and the Python package version are kept in sync. The
postinstall script installs the exact matching Python version:

```bash
hermes-agent==<npm package version>
```

This avoids silently installing a newer Python Hermes runtime than the npm
wrapper was published for.

## How to audit locally

Review the install script:

```bash
npm pack hermes-agent
tar -xzf hermes-agent-*.tgz
cat package/scripts/postinstall.js
cat package/lib/python-launcher.js
```

Install without running lifecycle scripts:

```bash
npm install -g hermes-agent --ignore-scripts
```

Then install the Python runtime manually:

```bash
python -m pip install --upgrade hermes-agent==0.14.0
```

## Why security scanners flag this package

Some scanners flag every npm package with `preinstall`, `install`, or
`postinstall` scripts because those scripts can execute code automatically.
That warning is useful and should not be ignored.

For this package, the install script is intentionally small and exists only to
install the pinned Python Hermes Agent runtime. Users who prefer not to run npm
lifecycle scripts can use `--ignore-scripts` and install the Python package
manually.
