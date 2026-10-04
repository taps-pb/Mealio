# Offline nutrition verification — 2026-10-04

These checks cover the local production build and automated browser tests, not
an authenticated test on the owner's phone. A production release must succeed
before the separate owner-requested history recalculation is applied.

## Executed checks

| Command/check | Actual result |
|---|---|
| `npm test` | 193 tests passed, 26 files; includes parser, resolver, correction/recipe persistence, non-destructive history migration and unrelated existing tests |
| Offline parser/resolver tests | All 25 exact owner strings exercised with network APIs disabled; both resolved and explicitly unknown outcomes asserted |
| `python3 -m unittest scripts/test_prepare_indb.py scripts/test_food_imports.py` | 9 passed |
| `npm run food:validate` | Passed; 66 foods, zero active validation errors |
| Two full import/build runs | All six normalized/runtime artifact checksums identical |
| `npm run typecheck` | Passed |
| `npm run lint` | Passed |
| `npm run build` | Passed, including offline dataset prebuild and service-worker postbuild |
| `npm run test:browser` | 3 production-browser tests passed |
| `git diff --check` | Passed |
| Working-tree secret-pattern scan | Zero findings |
| Compiled browser asset scan against actual private environment values | 17 files, zero matches; values not printed |
| Runtime nutrition network/AI residual audit | Zero findings |

The browser suite tested: cached page reload with connectivity disabled;
estimate → teach a custom biscuit → reload; price clarification → remember 20 g
mapping → reload; custom ingredient recipe → reload; mobile width containment;
and an actual browser-process restart into offline mode with the persisted
library/service worker. A separate synthetic journal test asserted no request
to `/api/estimate`, preservation of manual meal totals, versioned snapshot save
and history display. The mobile screenshot was inspected locally.

The build reports one source-quality warning: the selected Uncle Chipps API
profile has impossible macro mass. The packaging photograph was reviewed and its
per-100-g values explicitly replace that invalid profile. Evidence and checksums
are recorded in the manifest; no product images are bundled.

The installed shell's 17 JS/CSS assets total **1,164,668 bytes**, or **312,860
bytes** summed gzip size, in addition to the small public HTML/data/manifest.
The database-only compressed artifact is **12,440 bytes**.

## Dataset reproducibility

Ran both importers from identical downloaded inputs and the catalog builder
twice. All six normalized/runtime artifacts had identical SHA256 checksums.
Catalog SHA256:
`1745a4f45d2dfa62c8e42a87904e73660230ddd728ed9ac53088d05b2200d5ac`.

The original public source archives/seed remain in ignored `data/raw/` and are
not required for normal builds from the committed reviewed normalized inputs.

## Benchmark

Node v22.23.3, macOS arm64; 25 corpus queries, then 2,500 cached queries; fetch
disabled. Index construction **1.880 ms**. First-pass median **0.210 ms**, p95
**1.738 ms**, max **4.907 ms**. Cached median **0.0122 ms**, p95 **0.0478 ms**.
Network calls: **0**. Exact measured output: `nutrition-benchmark.json`.

## Security and migration scope

Working-tree scan used the existing repository secret scanner's patterns over
tracked and non-ignored untracked files, printing only file/line findings, never
matched values. Private datasets, raw archives, owner clarification libraries,
encrypted history revisions, signing files and credentials are excluded from Git.

The runtime source audit found no AI endpoint/API-key reads or nutrition API
clients in `src`; no network-capable calls in the local engine or estimator UI.
Remaining private INDB/legacy correction modules are not in the estimation
import graph. The optional coding-worker bridge is independent development
tooling. Hosted obsolete environment settings can be removed when deploying.
