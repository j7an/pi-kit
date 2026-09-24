import assert from "node:assert/strict";
import { test } from "node:test";
import type { Decision, PermissionRequest } from "../src/decide.ts";
import {
  ALLOW_ONCE,
  ALLOW_SESSION,
  blockReason,
  DENY,
  describeRequest,
  gateErrorReason,
  promptUser,
} from "../src/prompt.ts";

const bash = (command: string): PermissionRequest => ({
  tool: "bash",
  command,
  paths: [],
  rawPaths: [],
});
const write = (raw: string): PermissionRequest => ({
  tool: "write",
  paths: [`/repo/${raw}`],
  rawPaths: [raw],
});

/** Minimal call recorder; the stdlib runner has no vi.fn(). */
function recorder<T>(impl: (...args: unknown[]) => Promise<T>) {
  const calls: unknown[][] = [];
  const fn = (...args: unknown[]): Promise<T> => {
    calls.push(args);
    return impl(...args);
  };
  return Object.assign(fn, { calls });
}

const ui = (answer: string | undefined) => ({ select: recorder(async () => answer) });

test("describeRequest: shows the command for bash", () => {
  assert.equal(describeRequest(bash("rm -rf /tmp")), "bash: rm -rf /tmp");
});

test("describeRequest: shows the path for a file tool", () => {
  assert.equal(describeRequest(write("a.txt")), "write: a.txt");
});

test("describeRequest: shows the tool name alone when there is nothing else", () => {
  assert.equal(describeRequest({ tool: "deploy", paths: [], rawPaths: [] }), "deploy");
});

test("blockReason: names the dimension and pattern that matched", () => {
  const reason = blockReason(
    { outcome: "deny", dimension: "bash", pattern: "rm -rf *" },
    bash("rm -rf /tmp"),
    { headless: false },
  );
  assert.match(reason, /pi-kit permissions/);
  assert.match(reason, /bash rule "rm -rf \*" \(deny\)/);
});

test("blockReason: quotes the matched segment of a compound command", () => {
  const reason = blockReason(
    { outcome: "deny", dimension: "bash", pattern: "rm -rf *", segment: "rm -rf ." },
    bash("cd build && rm -rf ."),
    { headless: false },
  );
  assert.match(reason, /matched segment "rm -rf \." of "cd build && rm -rf \."/);
});

test("blockReason: explains the outsideCwd case without quoting a pattern", () => {
  const reason = blockReason(
    { outcome: "ask", dimension: "outsideCwd", pattern: "outsideCwd" },
    { tool: "write", paths: ["/etc/hosts"], rawPaths: ["/etc/hosts"] },
    { headless: true },
  );
  assert.match(reason, /"\/etc\/hosts" is outside the working directory \(outsideCwd: ask\)/);
  assert.match(reason, /No UI is available to prompt/);
});

test("blockReason: attributes a default-mode block to defaultMode", () => {
  const reason = blockReason({ outcome: "deny" }, bash("ls"), { headless: false });
  assert.match(reason, /defaultMode is "deny"/);
});

test("blockReason: names the broken config when defaultMode was forced to ask", () => {
  const reason = blockReason({ outcome: "ask" }, bash("ls"), {
    headless: true,
    forcedAskProblem: "/repo/.pi/extensions/pi-kit-permissions.json: invalid JSON",
  });
  assert.match(reason, /defaultMode forced to ask/);
  assert.match(reason, /\/repo\/\.pi\/extensions\/pi-kit-permissions\.json: invalid JSON/);
});

test("gateErrorReason: is distinguishable from a policy decision", () => {
  assert.match(gateErrorReason(new Error("boom")), /gate_error/);
  assert.match(gateErrorReason(new Error("boom")), /boom/);
});

const req = bash("npm publish");
const decision: Decision = { outcome: "ask", dimension: "bash", pattern: "npm publish*" };

test("promptUser: offers exactly three options in a fixed order", async () => {
  const fake = ui(ALLOW_ONCE);
  await promptUser(fake, req, decision);
  assert.equal(fake.select.calls.length, 1);
  const [, options] = fake.select.calls[0] as [string, string[]];
  assert.deepEqual(options, [ALLOW_ONCE, ALLOW_SESSION, DENY]);
});

test("promptUser: includes what is being asked about in the message", async () => {
  const fake = ui(ALLOW_ONCE);
  await promptUser(fake, req, decision);
  const [message] = fake.select.calls[0] as [string, string[]];
  assert.match(message, /npm publish/);
  assert.match(message, /npm publish\*/);
});

test("promptUser: includes the matched segment when present", async () => {
  const fake = ui(ALLOW_ONCE);
  await promptUser(fake, bash("cd x && npm publish"), { ...decision, segment: "npm publish" });
  const [message] = fake.select.calls[0] as [string, string[]];
  assert.match(message, /segment "npm publish"/);
});

test("promptUser: maps each answer to its outcome", async () => {
  assert.equal(await promptUser(ui(ALLOW_ONCE), req, decision), "once");
  assert.equal(await promptUser(ui(ALLOW_SESSION), req, decision), "session");
  assert.equal(await promptUser(ui(DENY), req, decision), "deny");
});

test("promptUser: denies when the dialog is dismissed or times out", async () => {
  assert.equal(await promptUser(ui(undefined), req, decision), "deny");
});

test("promptUser: denies on an unrecognised answer", async () => {
  assert.equal(await promptUser(ui("something else"), req, decision), "deny");
});

test("promptUser: propagates a rejected dialog rather than reporting a policy deny", async () => {
  const rejecting = {
    select: recorder(async () => {
      throw new Error("ui exploded");
    }),
  };
  await assert.rejects(promptUser(rejecting, req, decision), /ui exploded/);
});
