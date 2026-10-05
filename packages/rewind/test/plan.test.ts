import assert from "node:assert/strict";
import { test } from "node:test";
import { type EntryLike, planRestore } from "../src/plan.ts";
import { RECORD_TYPE } from "../src/record.ts";

const a = "/repo/a.ts";
const b = "/repo/b.ts";
const A = "a".repeat(64);
const B = "b".repeat(64);
const C = "c".repeat(64);
const X = "d".repeat(64);

function rec(id: string, path: string, before: string | null, after: string | null): EntryLike {
  return { id, type: "custom", customType: RECORD_TYPE, data: { path, before, after } };
}

function msg(id: string): EntryLike {
  return { id, type: "message" };
}

function entries(old: EntryLike[], target: EntryLike[]): EntryLike[] {
  return [...old, ...target.filter((entry) => !old.some((other) => other.id === entry.id))];
}

test("going back restores the first before after the ancestor", () => {
  const old = [msg("m1"), rec("r1", a, A, B), msg("m2"), rec("r2", a, B, C)];
  const target = old.slice(0, 1);
  assert.deepEqual(
    planRestore(entries(old, target), old, target, () => C),
    [{ path: a, target: A, expected: C }],
  );
});

test("created file restores to null", () => {
  const old = [msg("m1"), rec("r1", a, null, B)];
  const target = old.slice(0, 1);
  assert.deepEqual(
    planRestore(entries(old, target), old, target, () => B),
    [{ path: a, target: null, expected: B }],
  );
});

test("sideways move takes the target branch's last after", () => {
  const trunk = [msg("m1"), rec("r1", a, A, B)];
  const old = [...trunk, rec("r2", a, B, C)];
  const target = [...trunk, rec("r3", a, B, X), rec("r4", a, X, A)];
  assert.deepEqual(
    planRestore(entries(old, target), old, target, () => C),
    [{ path: a, target: A, expected: C }],
  );
});

test("path touched only on the target segment uses its earliest before as expected", () => {
  const old = [msg("m1"), msg("m2")];
  const target = [...old.slice(0, 1), rec("r1", b, A, B)];
  assert.deepEqual(
    planRestore(entries(old, target), old, target, () => A),
    [{ path: b, target: B, expected: A }],
  );
});

test("parallel edits ignore stale intermediate before states", () => {
  const old = [msg("m1"), rec("r1", a, A, C), rec("r2", a, A, C)];
  const target = old.slice(0, 1);
  assert.deepEqual(
    planRestore(entries(old, target), old, target, () => C),
    [{ path: a, target: A, expected: C }],
  );
});

test("empty target branch restores every file to its first before", () => {
  const old = [rec("r1", a, A, B), rec("r2", b, null, C), rec("r3", a, B, X)];
  assert.deepEqual(
    planRestore(old, old, [], (path) => (path === a ? X : C)),
    [
      { path: a, target: A, expected: X },
      { path: b, target: null, expected: C },
    ],
  );
});

test("no changes yields an empty plan", () => {
  const branch = [msg("m1"), rec("r1", a, A, B)];
  assert.deepEqual(
    planRestore(branch, branch, branch, () => B),
    [],
  );
});

test("disk out of step after a code-only restore is still planned", () => {
  const old = [msg("m1"), rec("r1", a, A, B), msg("m2"), rec("r2", a, B, C), msg("m3")];
  const target = old.slice(0, -1);
  assert.deepEqual(
    planRestore(old, old, target, () => A),
    [{ path: a, target: C, expected: C }],
  );
});

test("target equal to disk is dropped", () => {
  const old = [msg("m1"), rec("r1", a, A, B), msg("m2"), rec("r2", a, B, C), msg("m3")];
  assert.deepEqual(
    planRestore(old, old, old.slice(0, -1), () => C),
    [],
  );
});

test("record only on an abandoned branch is still planned", () => {
  const all = [msg("u1"), msg("a1"), msg("u2"), rec("r1", a, A, B), msg("a2")];
  assert.deepEqual(
    planRestore(all, all.slice(0, 2), all.slice(0, 1), () => B),
    [{ path: a, target: A, expected: A }],
  );
});

test("earliest record wins across abandoned branches", () => {
  const all = [msg("m1"), rec("r1", a, A, B), rec("r2", a, B, X)];
  assert.deepEqual(
    planRestore(all, all.slice(0, 1), [], () => X),
    [{ path: a, target: A, expected: A }],
  );
});

test("earliest valid record supplies fallback even when before is null", () => {
  const all = [rec("bad", a, "bad", B), rec("r1", a, null, B), rec("r2", a, B, X)];
  assert.deepEqual(
    planRestore(all, [], [], () => X),
    [{ path: a, target: null, expected: null }],
  );
});

test("a deletion after on the target branch remains null", () => {
  const old = [rec("r1", a, A, B)];
  const target = [...old, rec("r2", a, B, null)];
  assert.deepEqual(
    planRestore(entries(old, target), old, target, () => B),
    [{ path: a, target: null, expected: B }],
  );
});

test("branches without a common id prefix still use their last after", () => {
  const old = [rec("r1", a, A, B)];
  const target = [rec("r2", a, A, C)];
  assert.deepEqual(
    planRestore(entries(old, target), old, target, () => B),
    [{ path: a, target: C, expected: B }],
  );
});

const invalidData: [string, unknown][] = [
  ["numeric path", { path: 1, before: A, after: B }],
  ["null data", null],
  ["missing data", undefined],
  ["primitive data", "record"],
  ["relative path", { path: "rel/a.ts", before: A, after: B }],
  ["missing before", { path: a, after: B }],
  ["missing after", { path: a, before: A }],
  ["numeric before", { path: a, before: 5, after: B }],
  ["numeric after", { path: a, before: A, after: 5 }],
  ["path traversal before", { path: a, before: "../../etc/passwd", after: B }],
  ["uppercase after", { path: a, before: A, after: "F".repeat(64) }],
  ["short after", { path: a, before: A, after: "f".repeat(63) }],
  ["long before", { path: a, before: "f".repeat(65), after: B }],
  ["non-hex before", { path: a, before: "g".repeat(64), after: B }],
];

for (const [name, data] of invalidData) {
  test(`ignores ${name} before reading disk or branch states`, () => {
    const invalid = { id: "bad", type: "custom", customType: RECORD_TYPE, data };
    assert.deepEqual(
      planRestore([invalid], [invalid], [invalid], () => {
        assert.fail("invalid record must not reach disk callback");
      }),
      [],
    );
    const valid = rec("valid", a, A, B);
    assert.deepEqual(
      planRestore([valid, invalid], [valid, invalid], [invalid], () => B),
      [{ path: a, target: A, expected: B }],
    );
  });
}

test("record-shaped entries require the custom entry type and rewind customType", () => {
  const data = { path: a, before: A, after: B };
  const invalid = [
    { id: "wrong-type", type: "message", customType: RECORD_TYPE, data },
    { id: "wrong-custom", type: "custom", customType: "other", data },
    { id: "missing-custom", type: "custom", data },
  ];
  assert.deepEqual(
    planRestore(invalid, invalid, [], () => {
      assert.fail("other entry types must not reach disk callback");
    }),
    [],
  );
});
