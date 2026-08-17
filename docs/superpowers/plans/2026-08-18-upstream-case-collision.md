# Upstream Case-Collision Incident Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore automatic cross-platform publication of upstream Release `v2026.8.16.2` without weakening pinned-release integrity checks.

**Architecture:** Configure the package-managed Git checkout as a sparse worktree that excludes only upstream repository metadata under `contributors/`. Resolve Release identity once in the prepare job and make downstream jobs apply the pinned metadata offline. Keep the existing clean-checkout publication gate and expose exact dirty paths when it fails.

**Tech Stack:** Node.js 20+ CommonJS, Python 3.13 metadata helper, Git sparse-checkout, uv, GitHub Actions, Node test runner.

## Global Constraints

- Windows, default macOS, and Linux must all install and run the same upstream commit.
- The upstream tag must still resolve to the full commit SHA stored in `package.json`.
- Only `contributors/` may be omitted; runtime source changes must remain visible to the clean-checkout gate.
- Smoke and publish jobs must not independently query mutable Release metadata.
- npm trusted publishing and provenance remain unchanged.
- Code comments must be in English.

---

### Task 1: Sparse runtime checkout

**Files:**
- Create: `lib/runtime-checkout.js`
- Modify: `scripts/postinstall.js`
- Create: `test/runtime-checkout.test.js`

**Interfaces:**
- Produces: `configureRuntimeSparseCheckout(sourceDirectory, runGit)` and `RUNTIME_SPARSE_PATTERNS`.
- Consumes: a `runGit(args, options)` callback whose `options.input` is passed to Git stdin.

- [ ] **Step 1: Write the failing integration test**

Create a temporary Git repository containing `pyproject.toml` and
`contributors/emails/example`, call `configureRuntimeSparseCheckout`, check out
the commit, and assert that the runtime file exists, `contributors/` does not,
and `git status --porcelain --untracked-files=no` is empty.

- [ ] **Step 2: Run the focused test and verify RED**

Run: `node --test test/runtime-checkout.test.js`

Expected: failure because `lib/runtime-checkout.js` does not exist.

- [ ] **Step 3: Implement the sparse-checkout boundary**

Use these exact non-cone patterns:

```text
/*
!/contributors/
```

Invoke `git -C <source> sparse-checkout set --no-cone --stdin` before the first
checkout. Extend the postinstall process runner to accept an `input` string and
pass it to `spawnSync` without using a shell.

- [ ] **Step 4: Verify GREEN and the affected upstream tag**

Run:

```powershell
node --test test/runtime-checkout.test.js
npm run postinstall
git -C runtime/hermes-agent status --porcelain --untracked-files=no
```

Expected: focused test passes and the exact `v2026.8.16.2` checkout is clean.

- [ ] **Step 5: Commit**

```text
git add lib/runtime-checkout.js scripts/postinstall.js test/runtime-checkout.test.js
git commit -m "fix: support upstream case-colliding metadata"
```

### Task 2: Offline application of prepared Release metadata

**Files:**
- Modify: `scripts/sync_upstream_version.py`
- Create: `test/sync-upstream-version.test.js`
- Modify: `.github/workflows/npm-publish.yml`

**Interfaces:**
- Produces: `SYNC_FROM_EXPECTED=1` mode consuming `EXPECTED_UPSTREAM_TAG`,
  `EXPECTED_UPSTREAM_COMMIT`, `EXPECTED_UPSTREAM_VERSION`, and
  `EXPECTED_UPSTREAM_DESCRIPTION_B64`.
- Produces prepare output: `upstream_description_b64`.

- [ ] **Step 1: Write failing offline-mode tests**

Invoke the Python script in a temporary directory with a copied `package.json`.
Assert that complete expected metadata updates the file without network access,
and missing or malformed expected values exit nonzero without modifying it.

- [ ] **Step 2: Run the focused test and verify RED**

Run: `node --test test/sync-upstream-version.test.js`

Expected: failure because the current script always calls GitHub.

- [ ] **Step 3: Implement deterministic metadata application**

Split metadata validation/application from network discovery. In online mode,
base64-encode the validated upstream description for `$GITHUB_OUTPUT`. In
offline mode, require all expected values, strictly decode UTF-8 description,
validate tag/SHA/SemVer, and apply them without calling `fetch_latest_release`.

- [ ] **Step 4: Wire downstream jobs to offline mode**

Keep network discovery only in `prepare`. Add the description output and set
`SYNC_FROM_EXPECTED=1` plus all expected inputs in every smoke and publish job.

- [ ] **Step 5: Verify GREEN**

Run:

```text
node --test test/sync-upstream-version.test.js
npm test
```

- [ ] **Step 6: Commit**

```text
git add scripts/sync_upstream_version.py test/sync-upstream-version.test.js .github/workflows/npm-publish.yml
git commit -m "ci: reuse prepared upstream release metadata"
```

### Task 3: Diagnostic status and polling cadence

**Files:**
- Modify: `lib/npm-channel.js`
- Modify: `scripts/runtime-smoke.js`
- Modify: `test/npm-channel.test.js`
- Modify: `.github/workflows/npm-publish.yml`
- Modify: `README.md`
- Modify: `SECURITY.md`

**Interfaces:**
- Produces: `parseGitStatusPorcelain(output)` returning stable nonempty status lines.
- Adds JSON status field: `runtimeDirtyPaths`.

- [ ] **Step 1: Write failing status parser tests**

Assert that empty output returns `[]` and multiline porcelain output preserves
each status code and path, including a rename entry.

- [ ] **Step 2: Run the focused test and verify RED**

Run: `node --test test/npm-channel.test.js`

Expected: failure because the parser and `runtimeDirtyPaths` do not exist.

- [ ] **Step 3: Implement diagnostic output**

Parse the already-collected porcelain output once, derive `runtimeDirty` from
the resulting array, return `runtimeDirtyPaths`, and include the array in smoke
failure output. Do not ignore any path in this layer.

- [ ] **Step 4: Reduce scheduled polling**

Replace the four-times-hourly cron with `17 * * * *`. Retain manual dispatch,
tag triggers, concurrency serialization, and all publication guards.

- [ ] **Step 5: Document the runtime boundary**

Explain that executable source is a commit-pinned Git checkout while upstream
`contributors/` metadata is intentionally absent for case-insensitive
filesystem compatibility. Document that integrity checks still cover all
runtime source and that polling runs hourly.

- [ ] **Step 6: Verify GREEN**

Run:

```text
node --test test/npm-channel.test.js
npm test
git diff --check
```

- [ ] **Step 7: Commit**

```text
git add lib/npm-channel.js scripts/runtime-smoke.js test/npm-channel.test.js .github/workflows/npm-publish.yml README.md SECURITY.md
git commit -m "ci: harden release polling diagnostics"
```

### Task 4: Full incident verification and delivery

**Files:**
- Verify only; change files only if a failing test demonstrates an issue.

**Interfaces:**
- Consumes all deliverables from Tasks 1-3.

- [ ] **Step 1: Synchronize exact affected metadata in the isolated worktree**

Use the authenticated online sync and verify package version `0.20.3`, tag
`v2026.8.16.2`, and commit `7339f5f160db5c96657a3bab60151227cc61f66c`.

- [ ] **Step 2: Run full local verification**

Run:

```text
npm test
npm run postinstall
npm run smoke
npm pack --dry-run
git diff --check
```

The runtime checkout must be clean and report channel `npm-release`.

- [ ] **Step 3: Push and open a ready PR**

Use the configured `wyrtensi` Git identity and the existing feature branch.

- [ ] **Step 4: Wait for all GitHub checks**

Require Ubuntu, macOS, Windows, and external Socket checks to pass. Do not merge
on partial success.

- [ ] **Step 5: Merge and restore automation**

Merge the PR, verify `main`, re-enable `npm-publish.yml`, manually dispatch one
run, and watch it through npm trusted publishing.

- [ ] **Step 6: Verify npm publication**

Confirm npm `latest`, upstream tag, upstream commit, integrity, and provenance
for `hermes-agent@0.20.3`.
