#!/bin/sh
# Exercise the changelog generator against a stubbed git: no repository, identity or network.
set -eu
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT HUP INT TERM
node --input-type=module - "$work" <<'NODE'
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const work = process.argv[2];
const script = resolve("scripts/changelog.mjs");
const bin = join(work, "bin");
const repo = join(work, "repo");
const pkg = join(repo, "packages/demo");
const workflow = join(repo, ".github/workflows/publish-demo.yml");
mkdirSync(bin);
mkdirSync(pkg, { recursive: true });
mkdirSync(join(repo, ".github/workflows"), { recursive: true });
writeFileSync(join(pkg, "package.json"), JSON.stringify({ name: "@pi-kit/demo", version: "1.10.0" }));
writeFileSync(
  join(bin, "git"),
  `#!/bin/sh
printf '%s\\n' "$*" >> "$LOG"
case "$1 $2" in
  'rev-parse --show-toplevel') printf '%s\\n' "$REPO" ;;
  'rev-parse --is-shallow-repository') [ "$CASE" = shallow ] && echo true || echo false ;;
  'tag -l')
    [ "$CASE" = untagged ] && exit 0
    printf '%s\\n' demo/v1.2.0 demo/v1.10.0 demo/v1.0.0 demo/v2.0.0-beta.1 demo/vnext demo/v1.1.0 ;;
  'log -1')
    [ "$CASE" = signed ] && echo 'gpg: Signature made Sat Oct 24 23:26:45 2026 PDT'
    case "$4" in
      demo/v1.0.0) echo 2026-01-01 ;;
      demo/v1.1.0) echo 2026-02-02 ;;
      demo/v1.2.0) echo 2026-03-03 ;;
      demo/v1.10.0) echo 2026-04-04 ;;
      *) exit 1 ;;
    esac ;;
  'log --reverse')
    [ "$(pwd -P)" = "$(cd "$REPO" && pwd -P)" ] || exit 1
    case "$4" in
      demo/v1.0.0..demo/v1.1.0) printf '%s\\n' 'feat(demo): add thing (#3)' 'chore(release): bump version files to 1.1.0' 'fix(demo): mend (#5) thing' 'fix(demo): mend thing (#4)' ;;
      demo/v1.1.0..demo/v1.2.0) printf '%s\\n' 'fix(shared): resolve paths (#7)' 'chore(release): bump version files to 1.2.0' ;;
      demo/v1.2.0..demo/v1.10.0) printf '%s\\n' 'chore(release): bump version files to 1.10.0' ;;
      *) exit 1 ;;
    esac ;;
  *) exit 1 ;;
esac
`,
  { mode: 0o755 },
);
const scope = (line) =>
  writeFileSync(workflow, `jobs:\n  publish:\n    with:\n      source-paths: "elsewhere"\n${line}`);
const run = (scenario) => {
  const log = join(work, `${scenario}.log`);
  writeFileSync(log, "");
  writeFileSync(join(pkg, "CHANGELOG.md"), "stale\n");
  const result = spawnSync(process.execPath, [script], {
    cwd: pkg,
    encoding: "utf8",
    env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, CASE: scenario, LOG: log, REPO: repo },
  });
  assert.ifError(result.error);
  return {
    status: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
    calls: readFileSync(log, "utf8"),
    changelog: readFileSync(join(pkg, "CHANGELOG.md"), "utf8"),
  };
};

scope('      paths: "packages/demo packages/shared"\n');
const released = run("released");
assert.equal(released.status, 0, released.stderr);
assert.equal(released.stdout, "");
assert.equal(
  released.changelog,
  `# Changelog

## [1.10.0] - 2026-04-04

- No pull requests in this release touched this package.

## [1.2.0] - 2026-03-03

- fix(shared): resolve paths ([#7](https://github.com/j7an/pi-kit/pull/7))

## [1.1.0] - 2026-02-02

- feat(demo): add thing ([#3](https://github.com/j7an/pi-kit/pull/3))
- fix(demo): mend thing ([#4](https://github.com/j7an/pi-kit/pull/4))

## [1.0.0] - 2026-01-01

- First release.
`,
);
assert.ok(released.calls.includes("tag -l demo/v* --merged HEAD\n"), released.calls);
assert.ok(
  released.calls.includes(
    "log --reverse --format=%s demo/v1.0.0..demo/v1.1.0 -- packages/demo packages/shared\n",
  ),
  released.calls,
);

const untagged = run("untagged");
assert.equal(untagged.status, 0, untagged.stderr);
assert.equal(untagged.changelog, "# Changelog\n\n## [1.10.0]\n\n- First release.\n");

const shallow = run("shallow");
assert.equal(shallow.status, 1);
assert.match(shallow.stderr, /full history/);
assert.equal(shallow.changelog, "stale\n");

// log.showSignature and similar settings add lines to git's output.
const signed = run("signed");
assert.equal(signed.status, 1);
assert.match(signed.stderr, /unexpected date/);
assert.equal(signed.changelog, "stale\n");

scope("");
const unscoped = run("released");
assert.equal(unscoped.status, 1);
assert.match(unscoped.stderr, /publish-demo\.yml/);
assert.equal(unscoped.changelog, "stale\n");

console.log("Changelog checks passed (released, untagged, shallow, signed, unscoped)");
NODE
