import assert from "node:assert/strict";
import { test } from "node:test";
import * as extension from "../extensions/index.ts";
import type { EntryLike } from "../src/plan.ts";
import { RECORD_TYPE } from "../src/record.ts";
import { blobRoot, createStore, MAX_AGE_MS, sha256 } from "../src/store.ts";
import { fakeFs } from "./fake-fs.ts";

// biome-ignore lint/suspicious/noExplicitAny: event registry spans Pi's hook types
type Handler = (event: any, ctx: any) => unknown;
type Entry = EntryLike & { parentId: string | null };
const PATH = "/repo/a";
const A = Uint8Array.of(65);
const B = Uint8Array.of(66);
const C = Uint8Array.of(67);

function recorder<T>(impl: (...args: unknown[]) => T) {
  const calls: unknown[][] = [];
  return Object.assign(
    (...args: unknown[]) => {
      calls.push(args);
      return impl(...args);
    },
    { calls },
  );
}

function fixture() {
  const fs = fakeFs({ [PATH]: B });
  const store = createStore("/agent", fs, () => MAX_AGE_MS + 1);
  for (const bytes of [A, B, C]) store.put(bytes);
  const entries: Entry[] = [];
  let leaf: string | null = null;
  const handlers = new Map<string, Handler>();
  const commands = new Map<string, { description: string; handler: Handler }>();
  let choice: string | undefined;
  let promptChoice: string | undefined;
  let nativeNavigation = false;
  let editorText = "draft";
  const navigationErrors: unknown[] = [];
  let approved = true;
  const api = {
    on: (name: string, handler: Handler) => handlers.set(name, handler),
    appendEntry: (customType: string, data: unknown) =>
      add({ type: "custom", customType, data }, `r${entries.length}`),
    registerCommand: (name: string, command: { description: string; handler: Handler }) =>
      commands.set(name, command),
  };
  function add(entry: Omit<Entry, "id" | "parentId">, id: string): Entry {
    const result = { ...entry, id, parentId: leaf };
    entries.push(result);
    leaf = id;
    return result;
  }
  const sessionManager = {
    getLeafId: () => leaf,
    getEntry: (id: string) => entries.find((entry) => entry.id === id),
    getEntries: () => [...entries],
    getBranch(id = leaf) {
      const branch: Entry[] = [];
      let entry = entries.find((entry) => entry.id === id);
      while (entry) {
        branch.unshift(entry);
        entry = entries.find((next) => next.id === entry?.parentId);
      }
      return branch;
    },
  };
  const ctx = {
    cwd: "/repo",
    hasUI: true,
    mode: "tui",
    isIdle: () => true,
    sessionManager,
    // Model the verified native boundary: same-leaf no-op, runner catches hook
    // errors, user targets move to their parent, and only success restores text.
    navigateTree: recorder(async (targetId) => {
      if (!nativeNavigation || targetId === leaf) return;
      const target = sessionManager.getEntry(String(targetId));
      assert.ok(target);
      let result: unknown;
      try {
        result = await tree(target.id);
      } catch (error) {
        navigationErrors.push(error);
      }
      if (result && typeof result === "object" && "cancel" in result && result.cancel) return;
      leaf = target.parentId;
      await fire("session_tree");
      if (!editorText.trim()) {
        const message = (target as Entry & { message: { content: string } }).message;
        ctx.ui.setEditorText(message.content);
      }
    }),
    ui: {
      select: recorder(async (title) =>
        nativeNavigation && title === "Rewind" ? promptChoice : choice,
      ),
      confirm: recorder(async () => approved),
      notify: recorder(() => undefined),
      onTerminalInput: recorder(() => () => undefined),
      getEditorText: () => editorText,
      setEditorText: recorder((text) => {
        editorText = String(text);
      }),
    },
  };
  function resume() {
    handlers.clear();
    assert.equal(typeof extension.createExtension, "function", "hook factory must exist");
    extension.createExtension(api as never, {
      agentDir: "/agent",
      fs,
      now: () => MAX_AGE_MS + 1,
      isEscape: (data) => data === "escape",
    });
  }
  resume();
  function fire(name: string, event: unknown = {}) {
    const handler = handlers.get(name);
    assert.ok(handler, `${name} must be registered`);
    return handler(event, ctx);
  }
  function prompt(id: string, content: unknown = id) {
    return add({ type: "message", message: { role: "user", content } } as never, id);
  }
  function record(id: string, before = A, after = B, path = PATH) {
    return add(
      {
        type: "custom",
        customType: RECORD_TYPE,
        data: { path, before: sha256(before), after: sha256(after) },
      },
      id,
    );
  }
  function tree(targetId: string) {
    return fire("session_before_tree", {
      preparation: {
        oldLeafId: leaf,
        targetId,
        commonAncestorId: "u1",
        entriesToSummarize: [],
        userWantsSummary: false,
      },
    });
  }
  return {
    fs,
    entries,
    handlers,
    commands,
    ctx,
    fire,
    prompt,
    record,
    tree,
    resume,
    navigationErrors,
    enableNavigation: () => {
      nativeNavigation = true;
      editorText = "";
    },
    choosePrompt: (value: string) => {
      promptChoice = value;
    },
    choose: (value: string | undefined) => {
      choice = value;
    },
    approve: (value: boolean) => {
      approved = value;
    },
    moveLeaf: (id: string | null) => {
      leaf = id;
    },
  };
}

function history() {
  const f = fixture();
  f.prompt("u1");
  f.record("r1");
  f.prompt("u2");
  return f;
}

const contents = (f: ReturnType<typeof fixture>) => f.fs.readFile(PATH);

test("registers capture, sweep and tree/fork hooks", () => {
  const f = fixture();
  assert.deepEqual([...f.handlers.keys()].sort(), [
    "session_before_fork",
    "session_before_tree",
    "session_start",
    "session_tree",
    "tool_call",
    "tool_result",
  ]);
});

test("capture appends one record and keeps unchanged results", async () => {
  const f = fixture();
  f.prompt("u1");
  await f.fire("tool_call", { toolName: "edit", toolCallId: "t1", input: { path: "a" } });
  await f.fire("tool_result", { toolCallId: "t1" });
  assert.deepEqual(f.entries[1]?.data, { path: PATH, before: sha256(B), after: sha256(B) });
  assert.equal(f.entries[1]?.customType, "pi-kit-rewind");
  assert.equal(f.entries.length, 2);
});

test("parallel capture pairs results and retains final A in A to B to A", async () => {
  const f = fixture();
  f.fs.writeFile(PATH, A, 0o644);
  for (const toolCallId of ["t1", "t2"]) {
    await f.fire("tool_call", { toolName: "edit", toolCallId, input: { path: "a" } });
  }
  f.fs.writeFile(PATH, B, 0o644);
  await f.fire("tool_result", { toolCallId: "t1" });
  f.fs.writeFile(PATH, A, 0o644);
  await f.fire("tool_result", { toolCallId: "t2" });
  assert.equal(f.entries.length, 2);
  assert.deepEqual(f.entries[1]?.data, { path: PATH, before: sha256(A), after: sha256(A) });
});

test("capture errors never block tools and warn once per path", async () => {
  const f = fixture();
  f.fs.readFile = () => {
    throw new Error("EACCES");
  };
  for (const toolCallId of ["t1", "t2"]) {
    assert.equal(
      await f.fire("tool_call", { toolName: "write", toolCallId, input: { path: "a" } }),
      undefined,
    );
    await f.fire("tool_result", { toolCallId });
  }
  assert.equal(f.entries.length, 0);
  assert.equal(f.ctx.ui.notify.calls.length, 1);
  assert.match(String(f.ctx.ui.notify.calls[0]?.[0]), /a won't be restorable \(EACCES\)/);
});

test("session_start sweeps old blobs", async () => {
  const f = fixture();
  const old = `${blobRoot("/agent")}/old`;
  f.fs.writeFile(old, A, 0o600);
  await f.fire("session_start");
  assert.equal(f.fs.readFile(old), undefined);
});

test("tree with an empty plan shows no menu", async () => {
  const f = history();
  assert.equal(await f.tree("u2"), undefined);
  assert.equal(f.ctx.ui.select.calls.length, 0);
});

test("tree without UI returns without a menu", async () => {
  const f = history();
  f.ctx.hasUI = false;
  assert.equal(await f.tree("u1"), undefined);
  assert.equal(f.ctx.ui.select.calls.length, 0);
});

test("both defers writes until session_tree and consumes the kept plan once", async () => {
  const f = history();
  f.choose(extension.RESTORE_BOTH);
  assert.equal(await f.tree("u1"), undefined);
  assert.deepEqual(contents(f), B);
  await f.fire("session_tree");
  assert.deepEqual(contents(f), A);
  assert.deepEqual(f.ctx.ui.notify.calls, [["Restored 1 files", "info"]]);
  f.fs.writeFile(PATH, C, 0o644);
  await f.fire("session_tree");
  assert.deepEqual(contents(f), C);
  assert.equal(f.ctx.ui.notify.calls.length, 1);
});

test("conversation-only leaves disk unchanged", async () => {
  const f = history();
  f.choose(extension.RESTORE_CONVERSATION);
  assert.equal(await f.tree("u1"), undefined);
  await f.fire("session_tree");
  assert.deepEqual(contents(f), B);
});

test("code-only restores immediately, cancels navigation and reports the result", async () => {
  const f = history();
  f.choose(extension.RESTORE_CODE);
  assert.deepEqual(await f.tree("u1"), { cancel: true });
  assert.deepEqual(contents(f), A);
  assert.deepEqual(f.ctx.ui.select.calls, [
    [
      "Rewind: 1 files changed since this point",
      [
        extension.RESTORE_BOTH,
        extension.RESTORE_CONVERSATION,
        extension.RESTORE_CODE,
        extension.CANCEL,
      ],
    ],
  ]);
  assert.deepEqual(f.ctx.ui.notify.calls, [["Restored 1 files", "info"]]);
});

for (const answer of [extension.RESTORE_CODE, extension.RESTORE_BOTH]) {
  test(`a blocked disk read reports its path and restores readable files: ${answer}`, async () => {
    const f = fixture();
    const readable = "/repo/readable";
    f.prompt("u1");
    f.record("blocked");
    f.record("readable", A, B, readable);
    f.prompt("u2");
    f.fs.writeFile(readable, B, 0o644);
    const read = f.fs.readFile;
    f.fs.readFile = (path) => {
      if (path === PATH) throw new Error("EACCES");
      return read(path);
    };
    f.enableNavigation();
    f.choosePrompt("1. u1");
    f.choose(answer);
    await rewind(f);
    assert.deepEqual(f.navigationErrors, []);
    assert.deepEqual(f.fs.readFile(readable), A);
    assert.deepEqual(read(PATH), B);
    assert.deepEqual(f.ctx.ui.notify.calls, [
      ["Restored 1 files, skipped 1: /repo/a (EACCES)", "info"],
    ]);
    assert.equal(f.ctx.ui.select.calls[1]?.[0], "Rewind: 2 files changed since this point");
    assert.equal(f.ctx.sessionManager.getLeafId(), answer === extension.RESTORE_CODE ? "u2" : null);
  });
}

for (const answer of ["Cancel", undefined]) {
  test(`tree ${answer ?? "Escape"} cancels without writing`, async () => {
    const f = history();
    f.choose(answer);
    assert.deepEqual(await f.tree("u1"), { cancel: true });
    await f.fire("session_tree");
    assert.deepEqual(contents(f), B);
  });
}

test("a later tree attempt discards a plan from a cancelled earlier navigation", async () => {
  const f = history();
  f.choose(extension.RESTORE_BOTH);
  await f.tree("u1");
  await f.tree("u2");
  await f.fire("session_tree");
  assert.deepEqual(contents(f), B);
});

for (const position of ["before", "at"] as const) {
  test(`fork ${position} restores the selected position inside its hook`, async () => {
    const f = history();
    f.fs.writeFile(PATH, C, 0o644);
    f.record("r2", B, C);
    f.choose(extension.FORK_RESTORE);
    assert.equal(await f.fire("session_before_fork", { entryId: "u2", position }), undefined);
    assert.deepEqual(contents(f), B);
    assert.deepEqual(f.ctx.ui.notify.calls, [["Restored 1 files", "info"]]);
    assert.deepEqual(f.ctx.ui.select.calls, [
      [
        "Rewind: 1 files changed since this point",
        [extension.FORK_RESTORE, extension.FORK_KEEP, extension.CANCEL],
      ],
    ]);
  });
}

test("fork at a record includes its after state", async () => {
  const f = history();
  f.choose(extension.FORK_RESTORE);
  assert.equal(await f.fire("session_before_fork", { entryId: "r1", position: "at" }), undefined);
  assert.deepEqual(contents(f), B);
  assert.equal(f.ctx.ui.select.calls.length, 0);
});

test("fork before the first prompt restores every file's first before state", async () => {
  const f = history();
  f.choose(extension.FORK_RESTORE);
  assert.equal(
    await f.fire("session_before_fork", { entryId: "u1", position: "before" }),
    undefined,
  );
  assert.deepEqual(contents(f), A);
});

for (const answer of ["Keep current code", "Cancel", undefined]) {
  test(`fork ${answer ?? "Escape"} does not write`, async () => {
    const f = history();
    f.choose(answer);
    assert.deepEqual(
      await f.fire("session_before_fork", { entryId: "u1", position: "before" }),
      answer === "Keep current code" ? undefined : { cancel: true },
    );
    assert.deepEqual(contents(f), B);
  });
}

test("busy fork with changes cancels before any menu or writes", async () => {
  const f = history();
  f.ctx.isIdle = () => false;
  f.choose(extension.FORK_RESTORE);
  assert.deepEqual(await f.fire("session_before_fork", { entryId: "u1", position: "before" }), {
    cancel: true,
  });
  assert.equal(f.ctx.ui.select.calls.length, 0);
  assert.deepEqual(contents(f), B);
  assert.match(
    String(f.ctx.ui.notify.calls[0]?.[0]),
    /wait for the response to finish, then fork again/,
  );
});

test("busy fork without changes proceeds", async () => {
  const f = history();
  f.ctx.isIdle = () => false;
  assert.equal(await f.fire("session_before_fork", { entryId: "u2", position: "at" }), undefined);
  assert.equal(f.ctx.ui.select.calls.length, 0);
  assert.equal(f.ctx.ui.notify.calls.length, 0);
});

test("fork without UI proceeds without a menu or writes", async () => {
  const f = history();
  f.ctx.hasUI = false;
  f.choose(extension.FORK_RESTORE);
  assert.equal(
    await f.fire("session_before_fork", { entryId: "u1", position: "before" }),
    undefined,
  );
  assert.deepEqual(contents(f), B);
});

for (const resumed of [false, true]) {
  test(`code-only then a later prompt restores again${resumed ? " after resume" : ""}`, async () => {
    const f = history();
    f.record("r2", B, C);
    f.prompt("u3");
    f.fs.writeFile(PATH, C, 0o644);
    f.choose(extension.RESTORE_CODE);
    await f.tree("u1");
    assert.deepEqual(contents(f), A);
    if (resumed) f.resume();
    await f.tree("u3");
    assert.deepEqual(contents(f), C);
    assert.deepEqual(f.ctx.ui.confirm.calls[0], [
      "Overwrite files changed outside the agent?",
      PATH,
    ]);
  });

  test(`conversation-only then an earlier prompt includes abandoned records${resumed ? " after resume" : ""}`, async () => {
    const f = fixture();
    f.prompt("u1");
    f.prompt("u2");
    f.record("r1");
    f.enableNavigation();
    f.choosePrompt("2. u2");
    f.choose(extension.RESTORE_CONVERSATION);
    await rewind(f);
    assert.equal(f.ctx.sessionManager.getLeafId(), "u1");
    assert.deepEqual(contents(f), B);
    assert.equal(f.entries.length, 3, "other selections must not append a marker");
    if (resumed) f.resume();
    const messages = f.ctx.sessionManager.getBranch().filter((entry) => entry.type === "message");
    f.choosePrompt("1. u1");
    f.choose(extension.RESTORE_CODE);
    await rewind(f);
    assert.deepEqual(contents(f), A);
    assert.deepEqual(
      f.ctx.sessionManager.getBranch().filter((entry) => entry.type === "message"),
      messages,
    );
    assert.equal(f.entries.filter((entry) => entry.customType === RECORD_TYPE).length, 1);
    assert.deepEqual(f.ctx.ui.confirm.calls[0], [
      "Overwrite files changed outside the agent?",
      PATH,
    ]);
  });
}

test("fresh extension restores persisted entries without tool calls", async () => {
  const f = history();
  f.resume();
  f.choose(extension.RESTORE_CODE);
  await f.tree("u1");
  assert.deepEqual(contents(f), A);
});

test("/rewind restores both code and the editor for a current root prompt", async () => {
  const f = fixture();
  f.prompt("u1", "first prompt");
  f.record("r1");
  f.moveLeaf("u1");
  f.enableNavigation();
  f.choosePrompt("1. first prompt");
  f.choose(extension.RESTORE_BOTH);
  await rewind(f);
  assert.deepEqual(contents(f), A);
  assert.equal(f.ctx.sessionManager.getLeafId(), null);
  assert.equal(f.ctx.ui.getEditorText(), "first prompt");
  assert.equal(f.entries.filter((entry) => entry.customType === RECORD_TYPE).length, 1);
});

for (const answer of [extension.CANCEL, undefined]) {
  test(`/rewind current prompt ${answer ?? "Escape"} preserves conversation and disk`, async () => {
    const f = fixture();
    f.prompt("u1");
    f.record("r1");
    f.moveLeaf("u1");
    f.enableNavigation();
    const messages = f.ctx.sessionManager.getBranch().filter((entry) => entry.type === "message");
    f.choosePrompt("1. u1");
    f.choose(answer);
    await rewind(f);
    assert.deepEqual(contents(f), B);
    assert.deepEqual(
      f.ctx.sessionManager.getBranch().filter((entry) => entry.type === "message"),
      messages,
    );
    assert.equal(f.ctx.ui.getEditorText(), "");
    assert.equal(f.ctx.ui.select.calls.length, 2, "current prompt must enter the rewind menu");
  });
}

test("declining a mixed-mode conflict keeps disk and reports the skip", async () => {
  const f = history();
  f.fs.writeFile(PATH, C, 0o644);
  f.choose(extension.RESTORE_CODE);
  f.approve(false);
  assert.deepEqual(await f.tree("u1"), { cancel: true });
  assert.deepEqual(contents(f), C);
  assert.deepEqual(f.ctx.ui.notify.calls, [
    ["Restored 0 files, skipped 1: /repo/a (changed outside the agent)", "info"],
  ]);
});

test("session_start resets capture warning suppression for the next session", async () => {
  const f = fixture();
  f.fs.readFile = () => {
    throw new Error("EACCES");
  };
  const call = { toolName: "write", toolCallId: "t1", input: { path: "a" } };
  await f.fire("tool_call", call);
  await f.fire("tool_call", call);
  await f.fire("session_start");
  await f.fire("tool_call", call);
  assert.equal(f.ctx.ui.notify.calls.length, 2);
});

test("session_start discards unfinished captures from the previous session", async () => {
  const f = fixture();
  await f.fire("tool_call", { toolName: "edit", toolCallId: "t1", input: { path: "a" } });
  await f.fire("session_start");
  f.fs.writeFile(PATH, C, 0o644);
  await f.fire("tool_result", { toolCallId: "t1" });
  assert.deepEqual(f.entries, []);
});

test("headless capture still records file changes", async () => {
  const f = fixture();
  f.ctx.hasUI = false;
  await f.fire("tool_call", { toolName: "write", toolCallId: "t1", input: { path: "a" } });
  f.fs.writeFile(PATH, C, 0o644);
  await f.fire("tool_result", { toolCallId: "t1" });
  assert.deepEqual(f.entries[0]?.data, { path: PATH, before: sha256(B), after: sha256(C) });
});

test("native factory registers the hooks without touching the filesystem", () => {
  const handlers = new Map<string, Handler>();
  extension.default({
    on: (name: string, handler: Handler) => handlers.set(name, handler),
    registerCommand: () => undefined,
  } as never);
  assert.deepEqual([...handlers.keys()].sort(), [
    "session_before_fork",
    "session_before_tree",
    "session_start",
    "session_tree",
    "tool_call",
    "tool_result",
  ]);
});

async function rewind(f: ReturnType<typeof fixture>) {
  const command = f.commands.get("rewind");
  assert.ok(command, "/rewind must be registered");
  return command.handler("", f.ctx);
}

test("/rewind is registered", () => {
  assert.ok(fixture().commands.has("rewind"));
});

test("/rewind lists user prompts newest first and navigates to the chosen one", async () => {
  const f = fixture();
  f.prompt("u1", "first");
  f.record("r1");
  f.prompt("u2", "second\nmore");
  f.choose("1. first");
  await rewind(f);
  assert.deepEqual(f.ctx.ui.select.calls, [["Rewind", ["2. second", "1. first"]]]);
  assert.deepEqual(f.ctx.navigateTree.calls, [["u1"]]);
});

test("/rewind joins text parts and truncates the first line", async () => {
  const f = fixture();
  f.prompt("u1", [
    { type: "text", text: "hello" },
    { type: "image", data: "ignored" },
    { type: "text", text: "world" },
  ]);
  f.prompt("u2", `${"a".repeat(80)}\nmore`);
  await rewind(f);
  assert.deepEqual(f.ctx.ui.select.calls, [["Rewind", [`2. ${"a".repeat(72)}`, "1. hello world"]]]);
  assert.deepEqual(f.ctx.navigateTree.calls, []);
});

test("/rewind while busy notifies and does not navigate", async () => {
  const f = history();
  f.ctx.isIdle = () => false;
  await rewind(f);
  assert.match(String(f.ctx.ui.notify.calls[0]?.[0]), /wait for the response to finish/);
  assert.deepEqual(f.ctx.ui.select.calls, []);
  assert.deepEqual(f.ctx.navigateTree.calls, []);
});

test("/rewind with no prompts notifies Nothing to rewind", async () => {
  const f = fixture();
  await rewind(f);
  assert.deepEqual(f.ctx.ui.notify.calls, [["Nothing to rewind", "info"]]);
  assert.deepEqual(f.ctx.ui.select.calls, []);
});

for (const mode of ["tui", "rpc", "print"]) {
  test(`session_start registers terminal input only in tui: ${mode}`, async () => {
    const f = fixture();
    f.ctx.mode = mode;
    await f.fire("session_start");
    assert.equal(f.ctx.ui.onTerminalInput.calls.length, mode === "tui" ? 1 : 0);
  });
}

test("/rewind without UI does not open a menu", async () => {
  const f = history();
  f.ctx.hasUI = false;
  await rewind(f);
  assert.deepEqual(f.ctx.ui.select.calls, []);
  assert.deepEqual(f.ctx.navigateTree.calls, []);
});
