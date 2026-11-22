#!/bin/sh
# Exercise release dispatch and run selection without GitHub or network access.
set -eu
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT HUP INT TERM
node --input-type=module - "$work" <<'NODE'
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const work = process.argv[2];
const bin = join(work, "bin");
mkdirSync(bin);
const stub = (name, body) => writeFileSync(join(bin, name), `#!/bin/sh\n${body}\n`, { mode: 0o755 });
stub("date", 'printf "%s\\n" "2026-10-05T12:00:00Z"');
stub("sleep", 'printf "sleep %s\\n" "$*" >> "$LOG"');
stub("gh", `
printf '%s\\n' "$*" >> "$LOG"
case "$1 $2" in
  'workflow run')
    case "$CASE:$3" in
      dispatch:tag-release.yml) exit 1 ;;
      fallback:tag-release.yml|empty:tag-release.yml|malformed:tag-release.yml|list:tag-release.yml) exit 0 ;;
    esac
    id=1
    [ "$3" = tag-release-rewind.yml ] && id=2
    printf 'https://github.com/x/y/actions/runs/%s\\n' "$id"
    ;;
  'run list')
    # gh's native --jq evaluates the query; use installed jq on fixture JSON.
    for query in "$@"; do :; done
    case "$CASE" in
      empty) printf '[]\\n' ;;
      malformed) printf '{\\n' ;;
      list) exit 1 ;;
      fallback) printf '%s\\n' '[{"databaseId":99,"createdAt":"2026-10-05T11:59:59Z"},{"databaseId":7,"createdAt":"2026-10-05T12:00:03Z"},{"databaseId":3,"createdAt":"2026-10-05T12:00:00Z"}]' ;;
      *) exit 1 ;;
    esac | jq -r "$query"
    ;;
  'run view')
    # A readable run prints its status, as gh does; the script must not pass that on.
    [ "$CASE" != gone ] && { [ "$CASE" != lag ] || [ "$(grep -c '^run view ' "$LOG")" -gt 2 ]; } && printf '%s\\n' '{"status":"completed"}'
    ;;
  'run watch') [ "$CASE" != both ] && [ "$CASE" != gone ] && [ "$CASE:$3" != watch:1 ] ;;
  *) exit 1 ;;
esac
`);
const run = (scenario, failure, both = false) => {
  const log = join(work, `${scenario}.log`);
  writeFileSync(log, "");
  const result = spawnSync("sh", ["scripts/rerelease-extensions.sh", "tag-release.yml", "tag-release-rewind.yml"], {
    encoding: "utf8",
    env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, CASE: scenario, LOG: log, GH_TOKEN: "stub", GH_REPO: "x/y" },
  });
  assert.ifError(result.error);
  assert.equal(result.status, failure ? 1 : 0, `${scenario}: ${result.stdout}${result.stderr}`);
  if (failure) {
    assert.equal(result.stdout, `::error::re-release failed: tag-release.yml${both ? " tag-release-rewind.yml" : ""}\n`);
  }
  return readFileSync(log, "utf8").trim().split("\n");
};
const first = "workflow run tag-release.yml --ref main -f bump=auto";
const second = "workflow run tag-release-rewind.yml --ref main -f bump=auto";
const view = (id) => `run view ${id} --json status`;
const watch = (id) => `run watch ${id} --exit-status --interval 60`;
const tail = [second, view(2), watch(2)];
assert.deepEqual(run("watch", true), [first, view(1), watch(1), ...tail]);
assert.deepEqual(run("both", true, true), [first, view(1), watch(1), ...tail]);
assert.deepEqual(run("success", false), [first, view(1), watch(1), ...tail]);
const fallback = run("fallback", false);
assert.deepEqual(fallback, [first, `run list --workflow tag-release.yml --event workflow_dispatch --branch main --json databaseId,createdAt --jq map(select(.createdAt >= "2026-10-05T12:00:00Z")) | sort_by(.createdAt) | last | .databaseId // empty`, view(7), watch(7), ...tail]);
assert.deepEqual(run("dispatch", true), [first, ...tail]);
assert.deepEqual(run("lag", false), [first, view(1), "sleep 3", view(1), "sleep 3", view(1), watch(1), ...tail]);
const gone = run("gone", true, true);
for (const id of [1, 2]) {
  assert.equal(gone.filter((line) => line === view(id)).length, 10);
  assert.equal(gone.filter((line) => line === watch(id)).length, 1);
}
assert.equal(gone.filter((line) => line === "sleep 3").length, 18);
for (const scenario of ["empty", "malformed", "list"]) {
  const log = run(scenario, true);
  assert.equal(log.filter((line) => line.startsWith("run list ")).length, 10);
  assert.equal(log.filter((line) => line === "sleep 3").length, 9);
  assert.deepEqual(log.slice(-3), tail);
  assert.ok(!log.some((line) => line.startsWith("run watch ") && line !== watch(2)));
  assert.ok(!log.some((line) => line.startsWith("run view ") && line !== view(2)));
}
console.log("Re-release checks passed (watch failures, success, fallback selection, dispatch failure, empty/malformed/failed listing, unreadable run)");
NODE
