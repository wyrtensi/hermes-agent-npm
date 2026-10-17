#!/usr/bin/env bash
# CI-only probe: does a real native 'hermes update' keep the npm bridge
# working? Expects package.json to be synced to an older upstream Release than
# the latest one, installs the packed bridge globally into a throwaway prefix
# (npm 11, so the install script runs), runs 'hermes update' with an isolated
# HERMES_HOME and records what changed. The final step asserts that the npm
# shim still launches.
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

note() { printf '%s\n' "$*" | tee -a "$summary"; }
section() { printf '\n### %s\n\n' "$1" >> "$summary"; echo "::group::$1"; }
endsection() { echo "::endgroup::"; }
block() { { echo '```text'; cat; echo '```'; } | tee -a "$summary"; }

set -e
tarball="$(npm pack --silent --pack-destination "$work" | tail -n 1)"
npm install --global "$work/$tarball"
export PATH="$bin_dir:$PATH"
set +e

section "Before native update"
{
  echo "bridge: $(node -p 'require(process.argv[1]).version' "$package_root/package.json")"
  echo "checkout HEAD: $(git -C "$runtime" rev-parse HEAD)"
  echo "shallow: $(git -C "$runtime" rev-parse --is-shallow-repository)"
  echo "hermes on PATH: $(command -v hermes)"
  hermes --version 2>&1
  hermes update --check 2>&1
  ls -la "$HOME/.local/bin" 2>&1 || true
} | block
endsection

section "hermes update --yes --no-gateway-restart"
timeout 1800 hermes update --yes --no-gateway-restart > "$work/update.log" 2>&1 < /dev/null
update_status=$?
tail -n 80 "$work/update.log" | block
note "exit code: $update_status"
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
  echo "hermes on PATH: $(command -v hermes)"
  echo "hermes-npm status:"; hermes-npm status 2>&1
} | block
endsection

section "npm shim after native update"
"$bin_dir/hermes" --version > "$work/after.out" 2> "$work/after.err"
shim_status=$?
{ cat "$work/after.out"; cat "$work/after.err"; } | block
note "npm shim exit code: $shim_status"
endsection

if [ "$update_status" -ne 0 ]; then
  echo "native 'hermes update' failed with exit code $update_status" >&2
fi
if [ "$shim_status" -ne 0 ]; then
  echo "the npm 'hermes' shim no longer launches after a native update" >&2
  exit 1
fi
exit "$update_status"
