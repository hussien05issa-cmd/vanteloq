# Dependency, secret and local performance checks

Checked October 1, 2026. No dependencies were installed, upgraded or changed. No production load was generated.

## Exact dependency inventory

- Lockfile: `package-lock.json`, format 3.
- SHA-256: `d31c6deb1fb86c671c297541f40c30c391b8959190430bd2511888fa2e0b9d8a`.
- 670 non-root package entries: 101 without the dev flag and 569 with the dev flag. Entries are package locations, not unique package names.
- Current advisory count/severity: **not yet determined**. Zero vulnerabilities must not be inferred.
- The repository defines `audit:dependencies` as `npm audit --omit=dev --audit-level=high`. The bundled runtime provided Node and pnpm, but no npm CLI was found in the runtime dependency tree.
- A read-only query to the official npm bulk advisory endpoint was prepared using only public package names and exact versions, excluding the root package and source code. The sandbox denied network access. Automatic approval review then rejected the metadata disclosure. No advisory response was received. An explicit approval request is pending with the parent agent; no alternate egress path or dependency change has been attempted.

Production reachability must be assessed separately from lockfile dev flags. Some dev-declared build packages provide code bundled into the production Worker. A finding cannot be dismissed solely because its lockfile entry is marked dev.

## Changed-code secret scan

Scanned 42 modified or new code/config files and 880 added lines. The scan covered added tracked lines plus new code/config files, excluding generated output reports. It checked private-key headers, common provider credential formats and suspicious credential string assignments, reporting only file/line/category metadata.

Result: **0 candidates**. No secret values were emitted. This is a bounded pattern scan, not proof that every conceivable secret format is absent.

Machine-readable coverage: `output/changed-code-secret-scan-2026-10-01.json`.

## Existing local performance checks

No dedicated Lighthouse or JavaScript/CSS bundle-size budget script is defined in `package.json`. The existing image-size budgets are in `tests/homepage-quality.test.mjs`.

Executed without rebuilding or making network requests:

```text
node --test --test-name-pattern='generated editorial visuals|supplied LexEdge ownership mark' tests/homepage-quality.test.mjs
```

Result: **2 tests passed, 0 failed**. Nine editorial WebP files are below their 160,000-byte limits; the largest is 105,206 bytes. The ownership logo is 51,661 bytes, below its 100,000-byte limit. These results establish local asset-budget compliance, not a Lighthouse score or production loading speed.

Exact measurements: `output/local-audit-measurements-2026-10-01.json`.
