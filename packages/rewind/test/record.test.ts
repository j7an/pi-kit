import assert from "node:assert/strict";
import { test } from "node:test";
import { createRecorder, type RewindRecord } from "../src/record.ts";
import { createStore, sha256 } from "../src/store.ts";
import { fakeFs } from "./fake-fs.ts";

const A = Uint8Array.of(0xff, 0x00, 0xfe);
const B = Uint8Array.of(0x01);
const PATH = "/repo/a.ts";

function fixture(initial: Record<string, Uint8Array> = {}) {
  const fs = fakeFs(initial);
  const store = createStore("/agent", fs, () => 0);
  const records: RewindRecord[] = [];
  const warnings: string[] = [];
  const recorder = createRecorder({
    fs,
    store,
    append: (record) => records.push(record),
    warn: (message) => warnings.push(message),
  });
  function call(id = "t1", path: unknown = "a.ts", toolName = "edit") {
    recorder.onToolCall({ toolName, toolCallId: id, input: { path } }, "/repo");
  }
  function result(id = "t1") {
    recorder.onToolResult({ toolCallId: id });
  }
  return { fs, store, records, warnings, recorder, call, result };
}

test("write to a new file records before null and after the new sha", () => {
  const f = fixture();
  f.call("t1", "a.ts", "write");
  f.fs.writeFile(PATH, B, 0o600);
  f.result();
  assert.deepEqual(f.records, [{ path: PATH, before: null, after: sha256(B) }]);
  assert.deepEqual(f.store.get(sha256(B)), B);
});

test("edit records before and after shas of the file bytes", () => {
  const f = fixture({ [PATH]: A });
  f.call();
  f.fs.writeFile(PATH, B, 0o600);
  f.result();
  assert.deepEqual(f.records, [{ path: PATH, before: sha256(A), after: sha256(B) }]);
  assert.deepEqual(f.store.get(sha256(A)), A);
});

test("path is resolved Pi-style", () => {
  const f = fixture();
  f.call("t1", "@src/a.ts", "write");
  f.result();
  assert.deepEqual(f.records, [{ path: "/repo/src/a.ts", before: null, after: null }]);
});

test("a record is appended even when the file is unchanged", () => {
  const f = fixture({ [PATH]: A });
  f.call();
  f.result();
  assert.deepEqual(f.records, [{ path: PATH, before: sha256(A), after: sha256(A) }]);
});

test("parallel A → B → A keeps the final state", () => {
  const f = fixture({ [PATH]: A });
  f.call("t1");
  f.call("t2");
  f.fs.writeFile(PATH, B, 0o600);
  f.result("t1");
  f.fs.writeFile(PATH, A, 0o600);
  f.result("t2");
  assert.deepEqual(f.records, [
    { path: PATH, before: sha256(A), after: sha256(B) },
    { path: PATH, before: sha256(A), after: sha256(A) },
  ]);
});

test("no record for other tools", () => {
  const f = fixture();
  for (const tool of ["read", "bash"]) {
    f.call(tool, "a.ts", tool);
    f.result(tool);
  }
  assert.deepEqual(f.records, []);
});

test("no record without a tool_result", () => {
  const f = fixture({ [PATH]: A });
  f.call();
  assert.deepEqual(f.records, []);
});

test("capture error does not throw and warns once per path", () => {
  const f = fixture();
  f.fs.readFile = () => {
    throw new Error("access denied");
  };
  assert.doesNotThrow(() => f.call("t1"));
  assert.doesNotThrow(() => f.call("t2"));
  f.result("t1");
  f.result("t2");
  assert.deepEqual(f.records, []);
  assert.deepEqual(f.warnings, ["pi-kit rewind: /repo/a.ts won't be restorable (access denied)"]);
});

test("parallel calls pair by toolCallId and read after at result time", () => {
  const f = fixture({ [PATH]: A });
  f.call("t1");
  f.fs.writeFile(PATH, B, 0o600);
  f.call("t2");
  f.result("t2");
  f.fs.unlink(PATH);
  f.result("t1");
  assert.deepEqual(f.records, [
    { path: PATH, before: sha256(B), after: sha256(B) },
    { path: PATH, before: sha256(A), after: null },
  ]);
  f.result("t1");
  assert.equal(f.records.length, 2);
});

test("non-string or missing paths are ignored", () => {
  const f = fixture();
  f.call("t1", 1);
  f.recorder.onToolCall({ toolName: "edit", toolCallId: "t2", input: {} }, "/repo");
  f.result("t1");
  f.result("t2");
  assert.deepEqual(f.records, []);
  assert.deepEqual(f.warnings, []);
});

test("result capture failure warns and consumes the pending call", () => {
  const f = fixture({ [PATH]: A });
  f.call();
  const readFile = f.fs.readFile;
  f.fs.readFile = () => {
    throw new Error("result unavailable");
  };
  assert.doesNotThrow(() => f.result());
  f.fs.readFile = readFile;
  f.result();
  assert.deepEqual(f.records, []);
  assert.deepEqual(f.warnings, [
    "pi-kit rewind: /repo/a.ts won't be restorable (result unavailable)",
  ]);
});

test("blob storage failure does not throw or append an incomplete record", () => {
  const f = fixture({ [PATH]: A });
  f.store.put = () => {
    throw new Error("disk full");
  };
  assert.doesNotThrow(() => f.call());
  f.result();
  assert.deepEqual(f.records, []);
  assert.deepEqual(f.warnings, ["pi-kit rewind: /repo/a.ts won't be restorable (disk full)"]);
});

test("append and warning failures do not escape capture", () => {
  const fs = fakeFs();
  const recorder = createRecorder({
    fs,
    store: createStore("/agent", fs, () => 0),
    append: () => {
      throw new Error("session unavailable");
    },
    warn: () => {
      throw new Error("UI unavailable");
    },
  });
  recorder.onToolCall({ toolName: "write", toolCallId: "t1", input: { path: "a.ts" } }, "/repo");
  assert.doesNotThrow(() => recorder.onToolResult({ toolCallId: "t1" }));
});

test("invalid file URLs do not escape capture", () => {
  const f = fixture();
  assert.doesNotThrow(() => f.call("t1", "file://%"));
  f.result();
  assert.deepEqual(f.records, []);
  assert.equal(f.warnings.length, 1);
  assert.match(f.warnings[0] ?? "", /^pi-kit rewind: file:\/\/% won't be restorable \(/);
});
