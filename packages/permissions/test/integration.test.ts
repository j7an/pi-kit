import assert from "node:assert/strict";
import { test } from "node:test";
import { createExtension, type ExtensionDeps } from "../extensions/index.ts";
import { globalConfigPath, projectConfigPath } from "../src/config/load.ts";
import { ALLOW_ONCE, ALLOW_SESSION, DENY } from "../src/prompt.ts";

// biome-ignore-start lint/suspicious/noExplicitAny: the registry holds handlers for multiple event types
type Handler = (event: any, ctx: any) => Promise<unknown>;
// biome-ignore-end lint/suspicious/noExplicitAny: stub registry

const AGENT_DIR = "/home/u/.pi/agent";
const CONFIG_DIR = ".pi";
const CWD = "/repo";
const GLOBAL = globalConfigPath(AGENT_DIR);
const PROJECT = projectConfigPath(CWD, CONFIG_DIR);
const STATUS_KEY = "pi-kit-permissions";

type Block = { block: boolean; reason: string; terminate?: boolean };

function recorder<T>(impl: (...args: unknown[]) => T) {
  const calls: unknown[][] = [];
  const fn = (...args: unknown[]): T => {
    calls.push(args);
    return impl(...args);
  };
  return Object.assign(fn, { calls });
}

function stubPi() {
  const handlers = new Map<string, Handler>();
  return {
    api: { on: (event: string, handler: Handler) => handlers.set(event, handler) },
    fire: (event: string, payload: unknown, ctx: unknown) => {
      const handler = handlers.get(event);
      if (!handler) throw new Error(`no handler registered for "${event}"`);
      return handler(payload, ctx);
    },
    registered: () => [...handlers.keys()],
  };
}

function stubDeps(files: Record<string, string> = {}): ExtensionDeps {
  return {
    agentDir: AGENT_DIR,
    configDirName: CONFIG_DIR,
    exists: (path) => Object.hasOwn(files, path),
    readFile: (path) => (Object.hasOwn(files, path) ? files[path] : undefined),
  };
}

function stubUi(selectAnswer: string | undefined = DENY) {
  return {
    select: recorder(async (): Promise<string | undefined> => selectAnswer),
    notify: recorder(() => undefined),
    setStatus: recorder(() => undefined),
  };
}

function stubCtx(overrides: Record<string, unknown> = {}) {
  return {
    cwd: CWD,
    hasUI: true,
    isProjectTrusted: () => true,
    ui: stubUi(),
    ...overrides,
  };
}

const call = (toolName: string, input: Record<string, unknown>) => ({
  type: "tool_call",
  toolName,
  toolCallId: "t1",
  input,
});

function build(files: Record<string, string> = {}) {
  const pi = stubPi();
  createExtension(pi.api as never, stubDeps(files));
  return pi;
}

const statusTexts = (ui: ReturnType<typeof stubUi>) =>
  ui.setStatus.calls.filter(([key]) => key === STATUS_KEY).map(([, value]) => value);

test("registers tool_call and session_start handlers", () => {
  const pi = build();
  assert.deepEqual(pi.registered().sort(), ["session_start", "tool_call"]);
});

test("returns undefined for a permitted call", async () => {
  const pi = build();
  assert.equal(
    await pi.fire("tool_call", call("read", { path: "src/App.ts" }), stubCtx()),
    undefined,
  );
});

test("blocks a denied bash command with an explanatory reason and no terminate", async () => {
  const pi = build();
  const result = (await pi.fire(
    "tool_call",
    call("bash", { command: "rm -rf /tmp/x" }),
    stubCtx(),
  )) as Block;
  assert.equal(result.block, true);
  assert.match(result.reason, /rm -rf \*/);
  assert.equal(result.terminate, undefined);
});

test("blocks a denied segment of a compound command", async () => {
  const pi = build();
  const result = (await pi.fire(
    "tool_call",
    call("bash", { command: "cd build && rm -rf ." }),
    stubCtx(),
  )) as Block;
  assert.equal(result.block, true);
  assert.match(result.reason, /segment "rm -rf \."/);
});

test("blocks a write to a denied path", async () => {
  const pi = build();
  const result = (await pi.fire("tool_call", call("write", { path: ".env" }), stubCtx())) as Block;
  assert.equal(result.block, true);
});

test("blocks writes whose paths Pi would normalize onto a denied target", async () => {
  const pi = build();
  const atPrefixed = (await pi.fire(
    "tool_call",
    call("write", { path: "@.env" }),
    stubCtx(),
  )) as Block;
  assert.equal(atPrefixed.block, true);
  const fileUrl = (await pi.fire(
    "tool_call",
    call("write", { path: `file://${CWD}/.env` }),
    stubCtx(),
  )) as Block;
  assert.equal(fileUrl.block, true);
});

test("ask prompts again after allow once", async () => {
  const pi = build();
  const ctx = stubCtx({ ui: stubUi(ALLOW_ONCE) });
  assert.equal(await pi.fire("tool_call", call("write", { path: "/etc/hosts" }), ctx), undefined);
  assert.equal(await pi.fire("tool_call", call("write", { path: "/etc/hosts" }), ctx), undefined);
  assert.equal(ctx.ui.select.calls.length, 2);
});

test("ask stops prompting after allow for this session", async () => {
  const pi = build();
  const ctx = stubCtx({ ui: stubUi(ALLOW_SESSION) });
  await pi.fire("tool_call", call("write", { path: "/etc/hosts" }), ctx);
  await pi.fire("tool_call", call("write", { path: "/etc/hosts" }), ctx);
  assert.equal(ctx.ui.select.calls.length, 1);
});

test("ask blocks when the user denies", async () => {
  const pi = build();
  const result = (await pi.fire(
    "tool_call",
    call("write", { path: "/etc/hosts" }),
    stubCtx(),
  )) as Block;
  assert.equal(result.block, true);
});

test("ask blocks and records nothing when the dialog is dismissed", async () => {
  const pi = build();
  const ui = stubUi();
  ui.select = recorder(async () => undefined);
  const ctx = stubCtx({ ui });
  const first = (await pi.fire("tool_call", call("write", { path: "/etc/hosts" }), ctx)) as Block;
  assert.equal(first.block, true);
  await pi.fire("tool_call", call("write", { path: "/etc/hosts" }), ctx);
  assert.equal(ctx.ui.select.calls.length, 2);
});

test("ask blocks with gate_error and records nothing when the dialog rejects", async () => {
  const pi = build();
  const ui = stubUi();
  ui.select = recorder(async () => {
    throw new Error("ui exploded");
  });
  const ctx = stubCtx({ ui });
  const first = (await pi.fire("tool_call", call("write", { path: "/etc/hosts" }), ctx)) as Block;
  assert.equal(first.block, true);
  assert.match(first.reason, /gate_error/);
  ui.select = recorder(async () => DENY);
  await pi.fire("tool_call", call("write", { path: "/etc/hosts" }), ctx);
  assert.equal(ui.select.calls.length, 1);
});

test("recorded approval cannot override deny for the same request", async () => {
  const files = {
    [GLOBAL]: JSON.stringify({ outsideCwd: "deny", paths: { ask: ["/etc/hosts"] } }),
  };
  const pi = build(files);
  const ui = stubUi(ALLOW_SESSION);
  const inside = stubCtx({ cwd: "/etc", ui });
  const outside = stubCtx({ cwd: "/repo", ui });
  assert.equal(
    await pi.fire("tool_call", call("write", { path: "/etc/hosts" }), inside),
    undefined,
  );
  assert.equal(ui.select.calls.length, 1);
  assert.equal(
    await pi.fire("tool_call", call("write", { path: "/etc/hosts" }), inside),
    undefined,
  );
  assert.equal(ui.select.calls.length, 1);
  const denied = (await pi.fire(
    "tool_call",
    call("write", { path: "/etc/hosts" }),
    outside,
  )) as Block;
  assert.equal(denied.block, true);
  assert.equal(ui.select.calls.length, 1);
});

test("headless blocks an ask outcome when there is no UI", async () => {
  const pi = build();
  const result = (await pi.fire(
    "tool_call",
    call("write", { path: "/etc/hosts" }),
    stubCtx({ hasUI: false }),
  )) as Block;
  assert.equal(result.block, true);
  assert.match(result.reason, /No UI is available/);
});

test("headless allows an ask outcome when headlessAsk is allow", async () => {
  const pi = build({ [GLOBAL]: JSON.stringify({ headlessAsk: "allow" }) });
  assert.equal(
    await pi.fire("tool_call", call("write", { path: "/etc/hosts" }), stubCtx({ hasUI: false })),
    undefined,
  );
});

test("malformed sibling overrides valid headlessAsk allow and names broken config", async () => {
  const pi = build({
    [GLOBAL]: JSON.stringify({ headlessAsk: "allow" }),
    [PROJECT]: "{ not json",
  });
  const result = (await pi.fire(
    "tool_call",
    call("bash", { command: "echo ready" }),
    stubCtx({ hasUI: false }),
  )) as Block;
  assert.equal(result.block, true);
  assert.match(result.reason, /defaultMode forced to ask/);
  assert.ok(result.reason.includes(PROJECT));
});

test("default deny cannot be loosened by a segment-only ask in headless mode", async () => {
  const pi = build({
    [GLOBAL]: JSON.stringify({ defaultMode: "deny", headlessAsk: "allow", bash: { ask: ["ls"] } }),
  });
  const result = (await pi.fire(
    "tool_call",
    call("bash", { command: "echo ready && ls" }),
    stubCtx({ hasUI: false }),
  )) as Block;
  assert.equal(result.block, true);
  assert.equal(result.terminate, undefined);
});

test("session_start raises a persistent banner naming the broken file", async () => {
  const pi = build({ [GLOBAL]: "{ not json" });
  const ctx = stubCtx();
  await pi.fire("session_start", { type: "session_start" }, ctx);
  const texts = statusTexts(ctx.ui);
  assert.equal(texts.length, 1);
  assert.match(String(texts[0]), /forced to ask/);
  assert.ok(String(texts[0]).includes(GLOBAL));
});

test("session_start clears a stale banner when config loads cleanly", async () => {
  const pi = build();
  const ctx = stubCtx();
  await pi.fire("session_start", { type: "session_start" }, ctx);
  assert.deepEqual(statusTexts(ctx.ui), [undefined]);
});

test("session_start warns when project config is untrusted without forcing ask", async () => {
  const pi = build({ [PROJECT]: JSON.stringify({ defaultMode: "deny" }) });
  const ctx = stubCtx({ isProjectTrusted: () => false });
  await pi.fire("session_start", { type: "session_start" }, ctx);
  assert.ok(ctx.ui.notify.calls.some(([msg]) => /untrusted/.test(String(msg))));
  assert.equal(await pi.fire("tool_call", call("bash", { command: "ls" }), ctx), undefined);
});

test("session_start reloads config when trust changes", async () => {
  const pi = build({ [PROJECT]: JSON.stringify({ bash: { deny: ["ls"] } }) });
  const untrusted = stubCtx({ isProjectTrusted: () => false });
  await pi.fire("session_start", { type: "session_start" }, untrusted);
  assert.equal(await pi.fire("tool_call", call("bash", { command: "ls" }), untrusted), undefined);
  const trusted = stubCtx({ isProjectTrusted: () => true });
  await pi.fire("session_start", { type: "session_start" }, trusted);
  const result = (await pi.fire("tool_call", call("bash", { command: "ls" }), trusted)) as Block;
  assert.equal(result.block, true);
});

test("failed session reload cannot retain the previous session policy", async () => {
  const pi = build();
  await pi.fire("session_start", { type: "session_start" }, stubCtx());
  assert.equal(await pi.fire("tool_call", call("bash", { command: "ls" }), stubCtx()), undefined);
  const broken = stubCtx({
    isProjectTrusted: () => {
      throw new Error("boom");
    },
  });
  await assert.rejects(pi.fire("session_start", { type: "session_start" }, broken));
  const result = (await pi.fire("tool_call", call("bash", { command: "ls" }), broken)) as Block;
  assert.equal(result.block, true);
  assert.match(result.reason, /gate_error/);
});

test("session_start clears session approvals", async () => {
  const pi = build({ [GLOBAL]: JSON.stringify({ outsideCwd: "allow", bash: { ask: ["rm *"] } }) });
  const ctx = stubCtx({ ui: stubUi(ALLOW_SESSION) });
  await pi.fire("session_start", { type: "session_start" }, ctx);
  await pi.fire("tool_call", call("bash", { command: "rm /tmp/a" }), ctx);
  assert.equal(ctx.ui.select.calls.length, 1);
  await pi.fire("session_start", { type: "session_start" }, ctx);
  await pi.fire("tool_call", call("bash", { command: "rm /tmp/a" }), ctx);
  assert.equal(ctx.ui.select.calls.length, 2);
});

test("forced ask prompts interactively and blocks headless with broken file", async () => {
  const files = { [GLOBAL]: "{ not json" };
  const interactive = build(files);
  const ctx = stubCtx();
  await interactive.fire("tool_call", call("bash", { command: "ls" }), ctx);
  assert.equal(ctx.ui.select.calls.length, 1);
  const headless = build(files);
  const result = (await headless.fire(
    "tool_call",
    call("bash", { command: "ls" }),
    stubCtx({ hasUI: false }),
  )) as Block;
  assert.equal(result.block, true);
  assert.match(result.reason, /defaultMode forced to ask/);
  assert.ok(result.reason.includes(GLOBAL));
});

test("lazy load reports malformed config and raises banner without session_start", async () => {
  const pi = build({ [GLOBAL]: "{ not json" });
  const ctx = stubCtx();
  await pi.fire("tool_call", call("read", { path: "src/App.ts" }), ctx);
  assert.ok(ctx.ui.notify.calls.some(([msg]) => String(msg).includes(GLOBAL)));
  const banners = statusTexts(ctx.ui);
  assert.equal(banners.length, 1);
  assert.ok(String(banners[0]).includes(GLOBAL));
  assert.match(String(banners[0]), /invalid JSON/);
  assert.match(String(banners[0]), /forced to ask/);
});

test("lazy load reports problems once across tool calls", async () => {
  const pi = build({ [GLOBAL]: "{ not json" });
  const ctx = stubCtx();
  await pi.fire("tool_call", call("read", { path: "a.ts" }), ctx);
  await pi.fire("tool_call", call("read", { path: "b.ts" }), ctx);
  assert.equal(ctx.ui.notify.calls.length, 2);
});

test("gate failure blocks with gate_error", async () => {
  const pi = build();
  const ctx = stubCtx({
    isProjectTrusted: () => {
      throw new Error("boom");
    },
  });
  const result = (await pi.fire("tool_call", call("bash", { command: "ls" }), ctx)) as Block;
  assert.equal(result.block, true);
  assert.match(result.reason, /gate_error/);
});
