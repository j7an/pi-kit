import assert from "node:assert/strict";
import { dirname } from "node:path";
import test from "node:test";
import { applyPlan, formatResult } from "../src/apply.ts";
import type { PlanStep } from "../src/plan.ts";
import { createStore, type Store, sha256 } from "../src/store.ts";
import { fakeFs } from "./fake-fs.ts";

const old = new Uint8Array([1, 2, 3]);
const restored = new Uint8Array([0xff, 0x00, 0xfe]);
const path = "/repo/a.ts";

function setup(initial: Record<string, Uint8Array> = { [path]: old }) {
  const fs = fakeFs(initial);
  const store = createStore("/agent", fs, () => 100);
  const target = store.put(restored);
  const prompts: { title: string; message: string }[] = [];
  const deps = {
    fs,
    store,
    now: () => 100,
    confirm: async (title: string, message: string) => {
      prompts.push({ title, message });
      return false;
    },
  };
  return { fs, store, target, prompts, deps };
}

function step(target: string | null, file = path, expected = sha256(old)): PlanStep {
  return { path: file, target, expected };
}

test("restores binary bytes exactly", async () => {
  const { fs, target, deps } = setup();
  assert.deepEqual(await applyPlan([step(target)], deps), { restored: [path], skipped: [] });
  assert.deepEqual(fs.readFile(path), restored);
});

test("null target deletes the file", async () => {
  const { fs, deps } = setup();
  assert.deepEqual(await applyPlan([step(null)], deps), { restored: [path], skipped: [] });
  assert.equal(fs.files.has(path), false);
});

test("null target with no file is a no-op restore", async () => {
  const { fs, deps, prompts } = setup({});
  fs.unlink = () => {
    throw new Error("must not unlink an absent file");
  };
  assert.deepEqual(await applyPlan([{ path, target: null, expected: null }], deps), {
    restored: [path],
    skipped: [],
  });
  assert.equal(prompts.length, 0);
});

test("keeps the existing mode and writes via a same-directory temp then rename", async () => {
  const { fs, target, deps } = setup();
  const file = fs.files.get(path);
  assert.ok(file);
  file.mode = 0o755;
  const writeFile = fs.writeFile;
  const rename = fs.rename;
  const events: string[] = [];
  fs.writeFile = (temp, bytes, mode) => {
    assert.notEqual(temp, path);
    assert.equal(dirname(temp), dirname(path));
    assert.deepEqual(fs.readFile(path), old);
    events.push("write");
    writeFile(temp, bytes, mode);
  };
  fs.rename = (from, to) => {
    assert.equal(to, path);
    assert.deepEqual(fs.readFile(from), restored);
    assert.deepEqual(fs.readFile(path), old);
    events.push("rename");
    rename(from, to);
  };
  await applyPlan([step(target)], deps);
  assert.deepEqual(events, ["write", "rename"]);
  assert.equal(fs.files.get(path)?.mode, 0o755);
});

test("creates a missing parent directory and uses the default file mode", async () => {
  const { fs, target, deps } = setup({});
  const missing = "/repo/gone/a.ts";
  const rename = fs.rename;
  fs.rename = (from, to) => {
    assert.equal(fs.dirs.get(dirname(to)), 0o755);
    assert.equal(fs.files.has(to), false);
    rename(from, to);
  };
  assert.deepEqual(await applyPlan([{ path: missing, target, expected: null }], deps), {
    restored: [missing],
    skipped: [],
  });
  assert.deepEqual(fs.readFile(missing), restored);
  assert.equal(fs.files.get(missing)?.mode, 0o644);
});

test("symlinks and hard links are skipped without reading or confirming them", async () => {
  const hard = "/repo/hard.ts";
  const { fs, target, deps, prompts } = setup({ [path]: old, [hard]: old });
  fs.links.add(path);
  fs.hardLinks.add(hard);
  const readFile = fs.readFile;
  fs.readFile = (file) => {
    if (file === path || file === hard) throw new Error("must not read links");
    return readFile(file);
  };
  assert.deepEqual(await applyPlan([step(target), step(null, hard)], deps), {
    restored: [],
    skipped: [
      { path, reason: "symlink" },
      { path: hard, reason: "hard link" },
    ],
  });
  assert.deepEqual(fs.files.get(path)?.data, old);
  assert.deepEqual(fs.files.get(hard)?.data, old);
  assert.equal(prompts.length, 0);
});

test("missing blob is skipped and the file is untouched", async () => {
  const { fs, deps } = setup();
  assert.deepEqual(await applyPlan([step(sha256(new Uint8Array([99])))], deps), {
    restored: [],
    skipped: [{ path, reason: "snapshot missing" }],
  });
  assert.deepEqual(fs.readFile(path), old);
});

for (const approved of [false, true]) {
  test(`conflict asks once for all files and ${approved ? "restores approved" : "preserves unapproved"} paths`, async () => {
    const second = "/repo/b.ts";
    const third = "/repo/c.ts";
    const external = new Uint8Array([9]);
    const { fs, target, deps, prompts } = setup({
      [path]: external,
      [second]: external,
      [third]: old,
    });
    deps.confirm = async (title, message) => {
      prompts.push({ title, message });
      return approved;
    };
    const result = await applyPlan([step(target), step(target, second), step(target, third)], deps);
    assert.deepEqual(prompts, [
      { title: "Overwrite files changed outside the agent?", message: `${path}\n${second}` },
    ]);
    assert.deepEqual(
      result,
      approved
        ? { restored: [path, second, third], skipped: [] }
        : {
            restored: [third],
            skipped: [
              { path, reason: "changed outside the agent" },
              { path: second, reason: "changed outside the agent" },
            ],
          },
    );
    assert.deepEqual(fs.readFile(path), approved ? restored : external);
    assert.deepEqual(fs.readFile(second), approved ? restored : external);
    assert.deepEqual(fs.readFile(third), restored);
  });
}

test("no confirm when nothing conflicts", async () => {
  const { target, deps, prompts } = setup();
  await applyPlan([step(target)], deps);
  assert.deepEqual(prompts, []);
});

test("an unexpectedly absent file requires conflict approval before recreation", async () => {
  const { fs, target, deps, prompts } = setup({});
  assert.deepEqual(await applyPlan([step(target)], deps), {
    restored: [],
    skipped: [{ path, reason: "changed outside the agent" }],
  });
  assert.equal(prompts.length, 1);
  assert.equal(fs.files.has(path), false);
});

for (const operation of ["lstat", "readFile", "writeFile", "mkdir", "rename", "unlink"] as const) {
  test(`a ${operation} error skips that file and continues`, async () => {
    const second = "/repo/b.ts";
    const { fs, target, deps } = setup({ [path]: old, [second]: old });
    const error = new Error(`Cannot ${operation}`);
    if (operation === "writeFile") {
      const original = fs.writeFile;
      fs.writeFile = (file, bytes, mode) => {
        if (file.startsWith(`${path}.`)) throw error;
        original(file, bytes, mode);
      };
    } else if (operation === "rename") {
      const original = fs.rename;
      fs.rename = (from, to) => {
        if (to === path) throw error;
        original(from, to);
      };
    } else if (operation === "mkdir") {
      fs.mkdir = () => {
        throw error;
      };
      // The second file's deletion does not need to create a directory.
    } else {
      const failAtPath =
        <T>(original: (file: string) => T) =>
        (file: string): T => {
          if (file === path) throw error;
          return original(file);
        };
      if (operation === "lstat") fs.lstat = failAtPath(fs.lstat);
      else if (operation === "readFile") fs.readFile = failAtPath(fs.readFile);
      else fs.unlink = failAtPath(fs.unlink);
    }
    const result = await applyPlan(
      [
        step(operation === "unlink" ? null : target),
        step(operation === "mkdir" ? null : target, second),
      ],
      deps,
    );
    assert.deepEqual(result, { restored: [second], skipped: [{ path, reason: error.message }] });
    assert.deepEqual(fs.files.get(path)?.data, old);
    if (operation === "mkdir") assert.equal(fs.files.has(second), false);
    else assert.deepEqual(fs.readFile(second), restored);
  });
}

test("a blob read error is reported without touching the file", async () => {
  const { fs, target, deps } = setup();
  const store: Store = {
    ...deps.store,
    get: () => {
      throw new Error("Cannot read snapshot");
    },
  };
  assert.deepEqual(await applyPlan([step(target)], { ...deps, store }), {
    restored: [],
    skipped: [{ path, reason: "Cannot read snapshot" }],
  });
  assert.deepEqual(fs.readFile(path), old);
});

test("formatResult reports the restored count without skips", () => {
  assert.equal(formatResult({ restored: [], skipped: [] }), "Restored 0 files");
  assert.equal(formatResult({ restored: [path], skipped: [] }), "Restored 1 files");
});

test("formatResult includes every skipped path and reason", () => {
  assert.equal(
    formatResult({
      restored: [path],
      skipped: [
        { path: "/repo/b.ts", reason: "symlink" },
        { path: "/repo/c.ts", reason: "snapshot missing" },
      ],
    }),
    "Restored 1 files, skipped 2: /repo/b.ts (symlink), /repo/c.ts (snapshot missing)",
  );
});

test("restoring preserves an unrelated timestamp-named temp file", async () => {
  const { fs, target, deps } = setup();
  const unrelated = `${path}.pi-kit-rewind-100`;
  const sentinel = new Uint8Array([7, 8, 9]);
  fs.writeFile(unrelated, sentinel, 0o600);
  assert.deepEqual(await applyPlan([step(target)], deps), { restored: [path], skipped: [] });
  assert.deepEqual(fs.readFile(path), restored);
  assert.deepEqual(fs.readFile(unrelated), sentinel);
});

test("a partial restore write removes its temp and preserves the original", async () => {
  const { fs, target, deps } = setup();
  const writeFile = fs.writeFile;
  fs.writeFile = (temp, bytes, mode) => {
    writeFile(temp, bytes.slice(0, 1), mode);
    throw new Error("EFBIG partial write");
  };
  assert.deepEqual(await applyPlan([step(target)], deps), {
    restored: [],
    skipped: [{ path, reason: "EFBIG partial write" }],
  });
  assert.deepEqual(fs.readFile(path), old);
  assert.deepEqual(
    [...fs.files.keys()].filter((file) => file.startsWith("/repo/")),
    [path],
  );
});

test("a failed rename removes the owned temp even for EEXIST", async () => {
  const { fs, target, deps } = setup();
  fs.rename = () => {
    throw Object.assign(new Error("EEXIST rename"), { code: "EEXIST" });
  };
  assert.deepEqual(await applyPlan([step(target)], deps), {
    restored: [],
    skipped: [{ path, reason: "EEXIST rename" }],
  });
  assert.deepEqual(fs.readFile(path), old);
  assert.deepEqual(
    [...fs.files.keys()].filter((file) => file.startsWith("/repo/")),
    [path],
  );
});

test("failed exclusive creation preserves the unrelated existing temp", async () => {
  const { fs, target, deps } = setup();
  const writeFile = fs.writeFile;
  const sentinel = Uint8Array.of(7, 8, 9);
  let existing = "";
  fs.writeFile = (temp, _bytes, mode) => {
    existing = temp;
    writeFile(temp, sentinel, mode);
    throw Object.assign(new Error("EEXIST exclusive creation"), { code: "EEXIST" });
  };
  assert.deepEqual(await applyPlan([step(target)], deps), {
    restored: [],
    skipped: [{ path, reason: "EEXIST exclusive creation" }],
  });
  assert.deepEqual(fs.readFile(path), old);
  assert.deepEqual(fs.readFile(existing), sentinel);
});

test("temp cleanup failure preserves the original restore error", async () => {
  const { fs, target, deps } = setup();
  const writeFile = fs.writeFile;
  fs.writeFile = (temp, bytes, mode) => {
    writeFile(temp, bytes.slice(0, 1), mode);
    throw new Error("original write failure");
  };
  fs.unlink = () => {
    throw new Error("cleanup failure");
  };
  assert.deepEqual(await applyPlan([step(target)], deps), {
    restored: [],
    skipped: [{ path, reason: "original write failure" }],
  });
  assert.deepEqual(fs.readFile(path), old);
});
