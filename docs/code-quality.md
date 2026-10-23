# Formatting and code analysis

Use the locally pinned Prettier 3.9.10 and Fallow 3.35.0 versions through Yarn. Both are MIT licensed. This setup follows [Prettier's local installation and CI pattern](https://prettier.io/docs/install) and [Fallow's explicit entry points and boundary zones](https://fallow.tools/docs/configuration/boundaries/). The analyzer is the official [fallow-rs/fallow](https://github.com/fallow-rs/fallow) project, published as the `fallow` package.

## Commands

Run these from the repository root after installing the app's dependencies:

```bash
yarn --cwd apps/forgecut_gui/ui format
yarn --cwd apps/forgecut_gui/ui format:check
yarn --cwd apps/forgecut_gui/ui analyze
yarn --cwd apps/forgecut_gui/ui analyze:architecture
yarn --cwd apps/forgecut_gui/ui analyze:health
```

`format` and `format:check` cover all supported repository files, including Electron, React, tests, scripts, CSS, HTML, configuration and documentation. The root Prettier configuration uses its defaults. Dependencies, generated builds, caches, coverage and package-manager lockfiles are excluded. CI checks formatting alongside the existing tests.

`analyze` reports unused code, duplication and health together. `analyze:architecture` checks cycles and configured import boundaries. `analyze:health` reports complexity findings and can exit 1 when findings exist. To request an explicitly advisory score, run:

```bash
yarn --cwd apps/forgecut_gui/ui fallow health --score --report-only
```

For machine-readable output, use `yarn --silent --cwd apps/forgecut_gui/ui fallow --format json --quiet`. Analysis results remain visible; there is no suppression baseline or automatic deletion step.

## Scope

Fallow runs from `apps/forgecut_gui/ui`, the repository's only JavaScript/TypeScript package. The config adds the renderer, Electron main/preload and supported Electron scripts as source entry points. Vite and Vitest supply their configuration and test roots. Generated output is excluded.

Import rules follow the existing process boundary: the renderer can import shared contract types, the backend can import the shared contract, and Electron shell code can import the backend and contract. The contract cannot import other application zones. Tests can exercise all zones. Boundary coverage requires every discovered file to belong to a zone, including the HTML entry point. This catches accidental renderer imports of backend implementation without imposing a new application design.

Tests remain in reachability and boundary analysis. They are excluded from health and duplication metrics so repeated fixtures do not dominate the assessment of application code and supported startup scripts. No custom policy rule packs or forbidden-call rules are configured.

## Findings on 23 October 2026

The scan covers Phase 1 plus this formatting change. It is a review snapshot, not a promise that the scores will stay fixed.

| Check                                        | Result                                                                                   |
| -------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Import cycles                                | 0                                                                                        |
| Import boundary or uncovered-file violations | 0                                                                                        |
| Unused files or dependencies                 | 0                                                                                        |
| Unresolved imports                           | 0                                                                                        |
| Cleanup candidates                           | 7 unused value exports, 3 unused type exports, 2 class members, 2 duplicate export names |
| Complexity/risk findings                     | 19: 5 critical, 4 high, 10 moderate                                                      |
| Health score                                 | 86.4/100, grade A, formula version 3                                                     |
| Duplication                                  | 3 overlapping clone groups in 2 files; 36 lines, about 0.52%                             |

The module boundaries are clear in this scan, but several functions concentrate a lot of decisions. These are useful review targets:

| Area                       | Cyclomatic complexity | Cognitive complexity | Reason to review                                        |
| -------------------------- | --------------------- | -------------------- | ------------------------------------------------------- |
| Timeline keyboard handler  | 33                    | 34                   | Many keyboard cases and conditional paths               |
| `EditingService.execute`   | 24                    | 31                   | Validation, dispatch and transaction handling meet here |
| `Inspector`                | 21                    | 24                   | Several item variants share one component               |
| `validateProject`          | 18                    | 41                   | Nested project invariants need careful review           |
| Timeline drag/trim handler | 17                    | 30                   | Interaction state and geometry branches                 |

One of the five critical findings is in the maintained Electron startup verification script. The other four concern application code. Duplicate blocks are concentrated in exporter clip setup and playback media loading; the exporter groups overlap, so they should not be treated as three independent extraction opportunities.

The unused-export list often means only that an `export` keyword is unnecessary. For example, `probeAsset`, timeline helpers and `TIMELINE_ZOOM_STEP_FACTOR` are still used inside their own files. The class-member candidates include `AppState.executeTimelineChange` and `AppState.autosave`, which have actual command-handler callers. Those two are confirmed static-analysis false positives and must not be deleted from this report alone. Duplicate `Thumbnail` and `WaveformData` export names merit a separate check for shared type ownership. No application symbols were removed in this PR.

## Interpretation and validation

Formatting did not change the number of complexity findings or clone groups. It increased source line counts, changing the duplication percentage from about 0.61% to 0.52% and average maintainability from 88.9 to 90.2. These movements come from formatting and metric denominators, not an architectural improvement.

The scan uses syntactic analysis and static test reachability estimates, not measured coverage or production execution evidence. An A grade does not establish correctness, low runtime coupling, good domain boundaries or adequate test assertions. Zero policy findings do not mean policy checks passed: no policy rule packs are configured. Git churn rankings are influenced by the repository's short history and broad historical commits.

Validation for this change: all 120 tests across 16 files pass; renderer and Electron TypeScript builds pass; Electron startup and shared editing verification pass under Xvfb. Existing React `act` and jsdom media warnings remain. The headless GPU diagnostic also remains while startup verification succeeds. All 55 reformatted files were checked against exact Prettier output from their prior contents. A temporary renderer-to-backend import was correctly rejected by Fallow and then removed. No new application behaviour or regression tests were added for formatting.

## TypeScript linting

Run `yarn --cwd apps/forgecut_gui/ui lint`. Production renderer, Electron and shared TypeScript are checked with Airbnb's base rules, TypeScript-aware recommended type checking and Prettier compatibility. Strict TypeScript compilation remains required. Explicit `any` and unsafe assignment, argument, call, member access and return rules are errors. Tests and generated build output are outside this production lint scope.

The [Airbnb configuration](https://github.com/airbnb/javascript/tree/master/packages/eslint-config-airbnb-base) (MIT) informs this setup. ESLint 8.57.1 matches that configuration's published peer range; it is a compatibility pin on an unsupported ESLint release and should be upgraded when migrating the Airbnb configuration. [TypeScript ESLint](https://typescript-eslint.io/getting-started/typed-linting/) (MIT) provides typed rules; the TypeScript import resolver understands NodeNext `.js` imports and renderer extensionless imports.

Project-specific choices retain named exports, serialized snake_case fields, guarded `continue` loops, sequential subprocess work and mutations of private transaction drafts. TypeScript handles type references and hoisted functions. Electron is a build-time dependency; its entry points may import it. React async event attributes are accepted, while floating promises and unsafe value operations remain checked. Empty callback sinks and already-handled catch blocks are allowed. These choices are explicit configuration rather than per-line suppression comments.

CI now runs on every pull request target, including stacked branches, and checks lint, formatting, tests and builds.
