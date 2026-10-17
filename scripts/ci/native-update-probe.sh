#!/usr/bin/env bash
# CI-only probe: does a real native 'hermes update' keep the npm bridge
# working, and does the bridge take the dependencies back when it reprovisions
# the checkout? Expects package.json to be synced to an older upstream Release
# than the latest one, installs the packed bridge globally into a throwaway
# prefix (npm 11, so the install script runs), runs 'hermes update' with an
# isolated HERMES_HOME and records what changed. It then checks both paths that
# return the checkout to the pinned commit:
#
#   1. 'npm install' of the same package over the native update (a fresh
#      checkout), and
#   2. after a second native update, a same-version 'hermes-npm update' (an
#      in-place reset of the checkout).
#
# After each, upstream's package manager must no longer select its own
# environment for the checkout, and nothing else under HERMES_HOME may change.
#
# Never run this on a workstation: upstream's updater can publish launchers
# into ~/.local/bin (POSIX) or register HERMES_HOME\bin in the user PATH
# (Windows).
set -uo pipefail

work="$(mktemp -d)"
prefix="$work/prefix"
export NPM_CONFIG_PREFIX="$prefix"
export HERMES_HOME="$work/hermes-home"
mkdir -p "$prefix" "$HERMES_HOME"
bin_dir="$prefix/bin"
package_root="$prefix/lib/node_modules/hermes-agent"
runtime="$package_root/runtime/hermes-agent"
summary="${GITHUB_STEP_SUMMARY:-$work/summary.md}"
failures=0

note() { printf '%s\n' "$*" | tee -a "$summary"; }
section() { printf '\n### %s\n\n' "$1" >> "$summary"; echo "::group::$1"; }
endsection() { echo "::endgroup::"; }
block() { { echo '```text'; cat; echo '```'; } | tee -a "$summary"; }
fail() { echo "::error::$*"; note "FAILED: $*"; failures=$((failures + 1)); }
expect() {
  local description="$1"
  shift
  if "$@"; then note "ok: $description"; else fail "$description"; fi
}
equals() { [ "$1" = "$2" ] || { echo "expected '$2', got '$1'" >&2; return 1; }; }
not_equals() { [ "$1" != "$2" ] || { echo "did not expect '$2'" >&2; return 1; }; }
missing() { [ ! -e "$1" ] || { echo "$1 still exists" >&2; return 1; }; }
contains() { grep -qF -- "$2" "$1" || { echo "'$2' not found in $1" >&2; return 1; }; }

status_field() {
  "$bin_dir/hermes-npm" status --json | node -e '
    let input = "";
    process.stdin.on("data", (chunk) => { input += chunk; });
    process.stdin.on("end", () => {
      const value = JSON.parse(input)[process.argv[1]];
      console.log(value === null || value === undefined ? "" : value);
    });' "$1"
}

# What upstream would load for the checkout: its committed environment (None
# once its record is gone) and whether its selection falls back to the
# package's own venv.
upstream_selection() {
  "$runtime/venv/bin/python" -c '
import sys
from pathlib import Path
from pm.environments import committed_venv, selected_venv
root = Path(sys.argv[1])
package_venv = (root / "venv").resolve()
print("committed_venv=%s" % committed_venv(root))
print("selected_is_package_venv=%s" % (selected_venv(root) == package_venv))
' "$runtime" 2>&1
}

# Every path under HERMES_HOME except this checkout's install state.
home_snapshot() {
  find "$HERMES_HOME" -mindepth 1 -not -path "$HERMES_HOME/installs/$install_key" \
    -not -path "$HERMES_HOME/installs/$install_key/*" | LC_ALL=C sort
}

expect_upstream_owned() {
  local label="$1"
  expect "$label: upstream recorded its environment under installs/<key> for this checkout" \
    equals "$(ls -A "$HERMES_HOME/installs" 2>/dev/null | tr '\n' ' ')" "$install_key "
  expect "$label: hermes-npm status reports upstream-pm" equals "$(status_field dependenciesOwner)" "upstream-pm"
  expect "$label: hermes-npm status does not report npm-release" not_equals "$(status_field runtimeChannel)" "npm-release"
  expect "$label: hermes-npm status names the selected environment" \
    equals "$(status_field dependencyEnvironment | grep -c "^$HERMES_HOME/installs/$install_key/environments/")" "1"
  expect "$label: hermes-npm status flags the self-managed install stamp" \
    equals "$(status_field upstreamSelfManagedStamp)" "true"
}

expect_npm_owned() {
  local label="$1" before_snapshot="$2"
  {
    echo "checkout HEAD: $(git -C "$runtime" rev-parse HEAD)"
    echo "install-stamp.json: $(cat "$runtime/install-stamp.json" 2>&1)"
    echo "HERMES_HOME/installs: $(ls -A "$HERMES_HOME/installs" 2>&1)"
    echo "environment upstream selects for the checkout:"
    upstream_selection
    echo "hermes-npm status:"; "$bin_dir/hermes-npm" status 2>&1
  } | block
  expect "$label: checkout is at the pinned commit" equals "$(git -C "$runtime" rev-parse HEAD)" "$pinned_commit"
  expect "$label: install-stamp.json is gone" missing "$runtime/install-stamp.json"
  expect "$label: installs/<key> is gone" missing "$HERMES_HOME/installs/$install_key"
  expect "$label: upstream has no committed environment" equals "$(upstream_selection | grep '^committed_venv=')" "committed_venv=None"
  expect "$label: upstream selects the package venv" \
    equals "$(upstream_selection | grep '^selected_is_package_venv=')" "selected_is_package_venv=True"
  expect "$label: hermes-npm status reports npm ownership" equals "$(status_field dependenciesOwner)" "npm"
  expect "$label: hermes-npm status reports npm-release" equals "$(status_field runtimeChannel)" "npm-release"
  home_snapshot > "$work/home-after.txt"
  expect "$label: nothing else under HERMES_HOME changed" diff -u "$before_snapshot" "$work/home-after.txt"
  "$bin_dir/hermes" --version > "$work/version.out" 2>&1
  local shim_status=$?
  block < "$work/version.out"
  expect "$label: npm shim launches" equals "$shim_status" "0"
}

native_update() {
  local log="$1"
  timeout 1800 "$bin_dir/hermes" update --yes --no-gateway-restart > "$log" 2>&1 < /dev/null
  local status=$?
  tail -n 80 "$log" | block
  note "exit code: $status"
  return "$status"
}

set -e
pinned_commit="$(node -p 'require("./package.json").hermesAgent.upstreamCommit')"
# 'hermes-npm update' resets the checkout in place only when the npm registry
# has no newer version than the installed one. Give the probe package the
# registry's latest version so that path is reachable; the pinned upstream
# Release stays the older one synced above.
npm pkg set "version=$(npm view hermes-agent version)"
tarball="$(npm pack --silent --pack-destination "$work" | tail -n 1)"
npm install --global "$work/$tarball"
export PATH="$bin_dir:$PATH"
install_key="$(node -e 'console.log(require(process.argv[1]).getInstallKey(process.argv[2]))' \
  "$package_root/lib/upstream-ownership.js" "$runtime")"
set +e

section "Before native update"
{
  echo "bridge: $(node -p 'require(process.argv[1]).version' "$package_root/package.json")"
  echo "pinned commit: $pinned_commit"
  echo "install key: $install_key"
  echo "checkout HEAD: $(git -C "$runtime" rev-parse HEAD)"
  echo "shallow: $(git -C "$runtime" rev-parse --is-shallow-repository)"
  echo "hermes on PATH: $(command -v hermes)"
  hermes --version 2>&1
  hermes update --check 2>&1
  ls -la "$HOME/.local/bin" 2>&1 || true
} | block
expect "fresh install: hermes-npm status reports npm-release" equals "$(status_field runtimeChannel)" "npm-release"
endsection

section "hermes update --yes --no-gateway-restart"
native_update "$work/update.log"
update_status=$?
endsection

section "After native update"
{
  echo "checkout HEAD: $(git -C "$runtime" rev-parse HEAD)"
  echo "shallow: $(git -C "$runtime" rev-parse --is-shallow-repository)"
  echo "git status:"; git -C "$runtime" status --short --untracked-files=all | head -n 20
  echo "in-tree venv console script:"; ls -la "$runtime/venv/bin/hermes" 2>&1
  echo "install-stamp.json:"; cat "$runtime/install-stamp.json" 2>&1
  echo "HERMES_HOME/installs:"; find "$HERMES_HOME/installs" -maxdepth 3 2>&1 | head -n 20
  for facts in "$HERMES_HOME"/installs/*/facts.json; do echo "$facts:"; cat "$facts" 2>&1; echo; done
  echo "HERMES_HOME top level:"; ls -la "$HERMES_HOME" 2>&1
  echo "~/.local/bin:"; ls -la "$HOME/.local/bin" 2>&1
  for launcher in "$HOME"/.local/bin/hermes*; do echo "$launcher:"; cat "$launcher" 2>&1; echo; done
  echo "hermes on PATH: $(command -v hermes)"
  echo "hermes-npm status:"; "$bin_dir/hermes-npm" status 2>&1
} | block
expect_upstream_owned "after native update"
endsection

section "npm shim after native update"
"$bin_dir/hermes" --version > "$work/after.out" 2> "$work/after.err"
shim_status=$?
{ cat "$work/after.out"; cat "$work/after.err"; } | block
note "npm shim exit code: $shim_status"
endsection

# The updater keys its environment record on the checkout path, which an npm
# reinstall keeps. The reinstall provisions a fresh checkout and must remove
# that record and the install stamp.
section "npm reinstall of the pinned release after the native update"
home_snapshot > "$work/home-before-reinstall.txt"
# --foreground-scripts: npm otherwise hides the output of a successful install
# script, and the removed paths it prints are what this section checks.
npm install --global --foreground-scripts "$work/$tarball" > "$work/reinstall.log" 2>&1
reinstall_status=$?
tail -n 60 "$work/reinstall.log" | block
expect "npm reinstall succeeds" equals "$reinstall_status" "0"
expect "npm reinstall provisions a fresh checkout" contains "$work/reinstall.log" "Preparing Hermes Agent"
expect "npm reinstall reports the removed upstream record" contains "$work/reinstall.log" "Removed upstream dependency record"
expect_npm_owned "after npm reinstall" "$work/home-before-reinstall.txt"
endsection

section "Second native update"
native_update "$work/update-2.log"
second_update_status=$?
expect "second native update succeeds" equals "$second_update_status" "0"
expect_upstream_owned "after second native update"
endsection

# Same npm version as the registry, checkout moved: 'hermes-npm update' resets
# the clean checkout in place and must also remove upstream's record and stamp.
section "Same-version hermes-npm update after the second native update"
home_snapshot > "$work/home-before-update.txt"
"$bin_dir/hermes-npm" update > "$work/npm-update.log" 2>&1
npm_update_status=$?
tail -n 40 "$work/npm-update.log" | block
expect "hermes-npm update succeeds" equals "$npm_update_status" "0"
expect "hermes-npm update resets the checkout in place" contains "$work/npm-update.log" "Resetting the clean runtime"
expect "hermes-npm update reports the removed install stamp" contains "$work/npm-update.log" "Removed upstream install stamp"
expect "hermes-npm update reports the removed upstream record" contains "$work/npm-update.log" "Removed upstream dependency record"
expect_npm_owned "after hermes-npm update" "$work/home-before-update.txt"
endsection

if [ "$update_status" -ne 0 ]; then
  echo "native 'hermes update' failed with exit code $update_status" >&2
fi
if [ "$shim_status" -ne 0 ]; then
  echo "the npm 'hermes' shim no longer launches after a native update" >&2
  exit 1
fi
if [ "$failures" -ne 0 ]; then
  echo "$failures ownership check(s) failed" >&2
  exit 1
fi
exit "$update_status"
