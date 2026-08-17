# Upstream case-collision incident design

## Incident

Upstream Release `v2026.8.16.2` contains two tracked paths that differ only by
letter case under `contributors/emails/`. Windows and default macOS filesystems
cannot represent both paths independently, so the checkout is immediately
dirty. The bridge correctly refuses to publish a runtime whose checkout does
not exactly represent the pinned Release.

The scheduled publish workflow currently repeats that failure every fifteen
minutes. Its matrix jobs also repeat the GitHub Release lookup already
performed by the prepare job, which caused a secondary HTTP 429 failure.

## Chosen architecture

The npm runtime checkout will use Git sparse-checkout and omit the upstream
`contributors/` tree. This directory is repository metadata rather than Python
runtime input. The same sparse configuration remains active during native Git
updates, so release installs and `hermes update` continue to use ordinary Git
without hiding modifications to runtime files.

The exclusion is deliberately narrow. A case-insensitive collision anywhere
outside `contributors/` remains an installation or smoke-test failure rather
than being ignored.

The prepare job remains the sole network authority for Release identity. It
resolves and validates the latest release tag, commit, and package version.
Smoke and publish jobs apply those exact expected values without contacting
the GitHub Release API again. This removes redundant requests and ensures all
jobs test the same immutable identity.

## Workflow behavior

- Scheduled polling runs once per hour at a non-round minute.
- Manual dispatch and `npm-v*` tag triggers remain available.
- A candidate Release is published only after Linux, macOS, and Windows smoke
  jobs pass.
- Runtime smoke failures print the exact tracked paths that made the checkout
  dirty.
- The workflow remains disabled while the incident fix is developed and is
  re-enabled only after the fix is merged.

## Testing

- Unit tests verify sparse-checkout setup and deterministic offline metadata
  application.
- A regression fixture contains two contributor paths differing only by case
  and proves the checkout stays clean on case-insensitive filesystems.
- Existing wrapper tests must remain green.
- Local Windows runtime provisioning and smoke tests use the exact affected
  Release `v2026.8.16.2`.
- GitHub Actions must pass on Ubuntu, macOS, and Windows before merge.

## Security and failure handling

Tag-to-commit verification remains unchanged and happens before checkout.
Sparse-checkout does not weaken validation of executable source. Offline jobs
accept expected metadata only when tag, full commit SHA, and SemVer all pass
the existing format constraints. Unknown or incomplete expected metadata
causes a hard failure.

The npm publication guard and trusted publishing configuration remain
unchanged. No failed smoke run can reach `npm publish`.
