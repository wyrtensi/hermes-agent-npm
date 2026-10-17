#!/usr/bin/env bash
# CI-only check of the bridge under npm 12, which blocks dependency install
# scripts by default. Packs the working tree, installs it globally into a
# throwaway prefix with npm 12 and no allow-scripts configuration, then
# asserts that the first 'hermes' launch provisions the runtime itself.
#
#   scripts/ci/npm12-smoke.sh            first launch only
#   scripts/ci/npm12-smoke.sh --update   also run 'hermes-npm update' to the
#                                        registry's latest release, which must
#                                        provision the new version without npm
#                                        running its install script
#
# Never run this on a workstation: it is written for disposable runners.
set -euo pipefail

npm12_version="12.2.0"
run_update=false
if [ "${1:-}" = "--update" ]; then run_update=true; fi

node -e '
const [major, minor] = process.versions.node.split(".").map(Number);
if (major < 24 || (major === 24 && minor < 15)) {
  console.error(`npm 12 needs Node.js >= 24.15, got ${process.version}`);
  process.exit(1);
}'

work="$(mktemp -d)"
# npm and Node.js on Windows need native paths; PATH entries need POSIX ones.
if [ "${RUNNER_OS:-}" = "Windows" ]; then work="$(cygpath -m "$work")"; fi
posix_path() { if [ "${RUNNER_OS:-}" = "Windows" ]; then cygpath -u "$1"; else printf '%s' "$1"; fi; }
prefix="$work/prefix"
userconfig="$work/empty.npmrc"
mkdir -p "$prefix"
: > "$userconfig"
# Keep every npm in this script, including the one 'hermes-npm update' starts
# from PATH, on the throwaway prefix with no user configuration.
export NPM_CONFIG_PREFIX="$prefix"
export NPM_CONFIG_USERCONFIG="$userconfig"
unset NPM_CONFIG_ALLOW_SCRIPTS npm_config_allow_scripts || true

if [ "${RUNNER_OS:-}" = "Windows" ]; then bin_dir="$prefix"; root_dir="$prefix/node_modules"; else bin_dir="$prefix/bin"; root_dir="$prefix/lib/node_modules"; fi

(cd "$work" && npm pack "npm@$npm12_version" --silent >/dev/null && tar xzf "npm-$npm12_version.tgz")
npm12() { node "$work/package/bin/npm-cli.js" "$@"; }
npm12 install --global "npm@$npm12_version" >/dev/null
export PATH="$(posix_path "$bin_dir"):$PATH"
test "$(npm --version)" = "$npm12_version"

if [ "$run_update" = true ]; then
  # Install below the registry release so 'hermes-npm update' has a newer
  # version to move to. The runtime pin itself is left unchanged.
  npm version 0.0.1-ci.0 --no-git-tag-version --allow-same-version >/dev/null
  trap 'git checkout -- package.json' EXIT
fi
tarball="$(npm pack --silent --pack-destination "$work" | tail -n 1)"
if [ "$run_update" = true ]; then git checkout -- package.json; trap - EXIT; fi

npm install --global "$work/$tarball" 2>&1 | tee "$work/install.log"
grep -q "install scripts blocked" "$work/install.log"
package_root="$root_dir/hermes-agent"
test -f "$package_root/package.json"
if [ -e "$package_root/.hermes-agent-runtime.json" ]; then
  echo "npm $npm12_version ran the install script; this check needs it blocked" >&2
  exit 1
fi

echo "::group::first hermes launch"
hermes --version > "$work/first.out" 2> "$work/first.err" || { cat "$work/first.err" >&2; exit 1; }
cat "$work/first.err" >&2
echo "::endgroup::"
cat "$work/first.out"
test -s "$work/first.out"
grep -q "one-time download" "$work/first.err"
if grep -q "one-time download\|Preparing Hermes Agent\|Synchronizing the upstream lockfile" "$work/first.out"; then
  echo "provisioning output leaked to stdout" >&2
  exit 1
fi

hermes --version > "$work/second.out" 2> "$work/second.err"
if grep -q "one-time download" "$work/second.err"; then
  echo "second launch provisioned again" >&2
  exit 1
fi
cmp "$work/first.out" "$work/second.out"

hermes-npm status --json > "$work/status.json"
node -e '
const status = require(process.argv[1]);
if (!status.runtimeReady || status.runtimeChannel !== "npm-release" || status.installScope !== "global") {
  console.error(JSON.stringify(status, null, 2));
  process.exit(1);
}' "$work/status.json"

if [ "$run_update" = true ]; then
  latest="$(npm view hermes-agent version --registry https://registry.npmjs.org)"
  echo "::group::hermes-npm update to $latest"
  hermes-npm update 2>&1 | tee "$work/update.log"
  echo "::endgroup::"
  grep -q "install scripts blocked" "$work/update.log"
  grep -q "npm did not run the hermes-agent install script" "$work/update.log"
  test "$(node -p 'require(process.argv[1]).version' "$package_root/package.json")" = "$latest"

  hermes --version > "$work/updated.out" 2> "$work/updated.err" || { cat "$work/updated.err" >&2; exit 1; }
  cat "$work/updated.out"
  if grep -q "one-time download" "$work/updated.err"; then
    echo "hermes-npm update left the runtime unprovisioned" >&2
    exit 1
  fi
  hermes-npm status --json > "$work/status.json"
  node -e '
const status = require(process.argv[1]);
if (!status.runtimeReady || status.runtimeChannel !== "npm-release" || status.npmVersion !== process.argv[2]) {
  console.error(JSON.stringify(status, null, 2));
  process.exit(1);
}' "$work/status.json" "$latest"
fi

echo "npm $npm12_version smoke passed"
