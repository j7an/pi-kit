# AGENTS.md

pi-kit is a set of small, self-audited extensions for the Pi coding agent.
Auditability is the product: each package must stay small enough to re-read in
one sitting. See `README.md` for the project and `packages/<name>/README.md`
for package behaviour.

## Commands

Run from the repository root.

- `pnpm install` — install the workspace
- `pnpm check` — typecheck, lint, knip, test; must pass before every commit
- `pnpm format` — apply Biome formatting and import order
- `node --test packages/<name>/test/<file>.test.ts` — run one test file
- `pnpm test --experimental-test-coverage` — show coverage; the CI `coverage`
  job gates PRs at 90% total and 90% changed lines

## Rules

- No build step: packages publish raw TypeScript. Relative imports use explicit
  `.ts` extensions.
- An extension's only runtime dependency may be `@pi-kit/shared`, written
  `workspace:*` (`pnpm pack` seals it to an exact version; never a range). Any
  other runtime dependency is admissible only if it is
  exact-pinned, in `bundleDependencies`, has no transitive dependencies and no
  lifecycle scripts, and is re-audited on every bump. Packages Pi supplies
  (`@earendil-works/pi-coding-agent`, `@earendil-works/pi-tui`, `typebox`)
  are optional `*` peers; see Pi's `docs/packages.md`.
- Code moves into `@pi-kit/shared` only when a second package needs it; until
  then it stays in its one consumer. Shared is not a Pi extension: no `pi` key,
  no `pi-package` keyword.
- Tests use `node:test` and `node:assert/strict` with top-level `test()` only:
  no subtests, no `t.mock`, no real filesystem or Pi install. Inject
  dependencies instead.
- Never assert a pinned version or SHA in a test; assert the invariant instead.
- Keep each package README in sync with its tests; the permissions precedence
  table is executed by `test/decide.test.ts`.
- Commits follow Conventional Commits (`feat(permissions): …`, `fix(ci): …`).
  Tag-release infers the version bump from them.
- Pin GitHub Actions to a full commit SHA with a `# vX.Y.Z` comment.
- Pi is pinned once, in the root `package.json`. Dependabot bumps it together
  with pi-tui in its own PR, which auto-merges when CI passes; the weekly
  `pi-window` CI job
  covers older Pi minors. `autoInstallPeers: false` keeps that pin the only Pi
  in the workspace.

## Adding a package

Releases are per package. A new `packages/<name>/` also needs:

- `.version-bump.<name>.json` pointing at its `package.json`
- a tag-release caller with `tag-prefix: "<name>/v"`, that bump config, and
  `paths: "packages/<name>"`, plus `packages/shared` when it depends on shared;
  without `paths`, every monorepo commit drives the bump
- a `publish-<name>.yml` caller modelled on `publish-permissions.yml`, with
  the same `paths` as its tag-release caller; without it, the release notes
  list every monorepo PR
- its tag-release workflow in the re-release list in `publish-shared.yml`
  when it depends on shared
- before bootstrap, the owner must allow its `<name>/v*` tags in the `npm`
  environment and cover its namespace with the existing release tag protections,
  preserving App bypass and required environment approvals
- a `knip.json` workspace entry and a row in the root README package table
- a `scripts/pack-probe-<name>.sh` probe, sourced by `scripts/assert-pack.sh`
  to verify the installed package's behaviour with real Pi
- runtime code under `src/` or `extensions/`, the only paths the `ci.yml`
  coverage job's `source-paths` globs gate; another layout must add its paths
  there, or its changes go ungated. A type-only module has no LCOV record, so
  it must go in the job's `exclude-paths`, or any change to it fails the gate

Releasing shared re-releases every extension. Release an extension by hand only
when `packages/shared` has no unreleased commits; the publish check that compares
shared with the repo refuses otherwise.

The `ci.yml` artifact job validates every package through
`scripts/assert-pack.sh`, which runs the shared `scripts/assert-package.mjs`
shape checks and the package's probe. Reuse these parameterised scripts.
The first npm publish is manual; configure npm trusted publishing afterwards.
