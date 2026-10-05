import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import test from "node:test";
import { blobRoot, createStore, MAX_AGE_MS, sha256 } from "../src/store.ts";
import { fakeFs } from "./fake-fs.ts";

const agentDir = "/agent";
const root = "/agent/pi-kit-rewind/blobs";
const bytes = new Uint8Array([0xff, 0x00, 0xfe]);

test("put stores bytes under their sha256 and get returns them", () => {
  const fs = fakeFs();
  const store = createStore(agentDir, fs, () => 100);
  const sha = store.put(bytes);
  assert.equal(sha, sha256(bytes));
  assert.match(sha, /^[0-9a-f]{64}$/);
  assert.equal(blobRoot(agentDir), root);
  assert.deepEqual(fs.files.get(join(root, sha))?.data, bytes);
  assert.deepEqual(store.get(sha), bytes);
});

test("sha256 produces the standard lowercase digest", () => {
  assert.equal(
    sha256(new Uint8Array()),
    "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
  );
});

test("put writes once and refreshes mtime on reuse", () => {
  const fs = fakeFs();
  const writes: string[] = [];
  const writeFile = fs.writeFile;
  fs.writeFile = (path, data, mode) => {
    writes.push(path);
    writeFile(path, data, mode);
  };
  let time = 100;
  const store = createStore(agentDir, fs, () => time);
  const sha = store.put(bytes);
  time += 1000;
  assert.equal(store.put(bytes.slice()), sha);
  assert.equal(fs.files.size, 1);
  assert.equal(fs.files.get(join(root, sha))?.mtimeMs, time);
  assert.equal(writes.length, 1);
  assert.ok(writes.every((path) => path !== join(root, sha)));
});

test("put writes via a temp file then rename", () => {
  const fs = fakeFs();
  const events: string[] = [];
  let temp = "";
  const writeFile = fs.writeFile;
  const rename = fs.rename;
  fs.writeFile = (path, data, mode) => {
    temp = path;
    events.push(`write:${path}`);
    writeFile(path, data, mode);
  };
  fs.rename = (from, to) => {
    assert.equal(fs.files.has(to), false);
    assert.deepEqual(fs.files.get(from)?.data, bytes);
    events.push(`rename:${from}:${to}`);
    rename(from, to);
  };
  const sha = createStore(agentDir, fs, () => 100).put(bytes);
  const final = join(root, sha);
  assert.notEqual(temp, final);
  assert.equal(dirname(temp), root);
  assert.deepEqual(events, [`write:${temp}`, `rename:${temp}:${final}`]);
  assert.equal(fs.files.size, 1);
});

test("blob directory is 0o700 and blobs are 0o600", () => {
  const fs = fakeFs();
  const sha = createStore(agentDir, fs, () => 100).put(bytes);
  assert.equal(fs.dirs.get(root), 0o700);
  assert.equal(fs.files.get(join(root, sha))?.mode, 0o600);
});

test("get returns undefined for a missing blob", () => {
  assert.equal(createStore(agentDir, fakeFs(), () => 100).get("missing"), undefined);
});

test("sweep deletes blobs older than 30 days and keeps fresh ones", () => {
  const fs = fakeFs({
    [join(root, "old")]: bytes,
    [join(root, "fresh")]: bytes,
    [join(root, "boundary")]: bytes,
  });
  const time = MAX_AGE_MS + 100;
  fs.utimes(join(root, "old"), time - MAX_AGE_MS - 1);
  fs.utimes(join(root, "fresh"), time - MAX_AGE_MS + 1);
  fs.utimes(join(root, "boundary"), time - MAX_AGE_MS);
  createStore(agentDir, fs, () => time).sweep();
  assert.equal(fs.files.has(join(root, "old")), false);
  assert.equal(fs.files.has(join(root, "fresh")), true);
  assert.equal(fs.files.has(join(root, "boundary")), true);
});

test("sweep ignores errors and continues with later blobs", () => {
  const fs = fakeFs({ [join(root, "blocked")]: bytes, [join(root, "old")]: bytes });
  const unlink = fs.unlink;
  fs.unlink = (path) => {
    if (path.endsWith("blocked")) throw new Error("Cannot delete");
    unlink(path);
  };
  assert.doesNotThrow(() => createStore(agentDir, fs, () => MAX_AGE_MS + 1).sweep());
  assert.equal(fs.files.has(join(root, "old")), false);
});

test("sweep ignores directory listing errors", () => {
  const fs = fakeFs();
  fs.readdir = () => {
    throw new Error("Cannot list");
  };
  assert.doesNotThrow(() => createStore(agentDir, fs, () => 100).sweep());
});

test("interleaved puts of identical bytes at the same time both complete", () => {
  const fs = fakeFs();
  const outer = createStore(agentDir, fs, () => 1000);
  const inner = createStore(agentDir, fs, () => 1000);
  const writeFile = fs.writeFile;
  let interleaved = false;
  let innerSha: string | undefined;
  fs.writeFile = (path, data, mode) => {
    writeFile(path, data, mode);
    if (!interleaved) {
      interleaved = true;
      innerSha = inner.put(bytes);
    }
  };
  const outerSha = outer.put(bytes);
  assert.equal(innerSha, outerSha);
  assert.deepEqual(outer.get(outerSha), bytes);
  assert.equal(fs.files.size, 1);
});
