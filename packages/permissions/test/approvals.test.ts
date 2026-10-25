import assert from "node:assert/strict";
import { test } from "node:test";
import {
  APPROVAL_ENTRY,
  type Approval,
  commandPrefix,
  isApproved,
  requestKey,
  restoreApprovals,
} from "../src/approvals.ts";
import type { PermissionRequest } from "../src/decide.ts";

const GUARD = [";", "&", "|", "<", ">", "$", "`", "(", ")", "{", "}", "\\", "\n", "\r"];

const bash = (command: string): PermissionRequest => ({
  tool: "bash",
  command,
  paths: [],
  rawPaths: [],
});
const prefix = (tool: string, value: string): Approval => ({
  kind: "prefix",
  tool,
  value,
  description: `${tool}: ${value} …`,
  cwd: "/repo",
});
const entry = (data: unknown, customType = APPROVAL_ENTRY) => ({
  type: "custom",
  customType,
  data,
});

test("commandPrefix: derives at most two words", () => {
  assert.equal(commandPrefix("git push origin main"), "git push");
  assert.equal(commandPrefix("npm run build"), "npm run");
  assert.equal(commandPrefix("curl https://x"), "curl");
  assert.equal(commandPrefix("git -C dir push"), "git");
  assert.equal(commandPrefix("git  push\torigin"), "git push");
});

test("commandPrefix: offers nothing for a non-plain command name", () => {
  assert.equal(commandPrefix("./build.sh"), undefined);
  assert.equal(commandPrefix("FOO=1 make"), undefined);
  assert.equal(commandPrefix('"git" push x'), undefined);
});

test("commandPrefix: offers nothing when the prefix is the whole command", () => {
  assert.equal(commandPrefix("git push"), undefined);
  assert.equal(commandPrefix("ls"), undefined);
  assert.equal(commandPrefix("  git push  "), undefined);
});

test("commandPrefix: offers nothing when the command fails the guard", () => {
  for (const ch of GUARD) {
    assert.equal(commandPrefix(`git push origin${ch}x`), undefined, JSON.stringify(ch));
  }
});

test("isApproved: a prefix covers whole-word extensions only", () => {
  const saved = [prefix("bash", "git push")];
  assert.equal(isApproved(saved, bash("git push")), true);
  assert.equal(isApproved(saved, bash("git push --tags")), true);
  assert.equal(isApproved(saved, bash("git  push\torigin")), true);
  assert.equal(isApproved(saved, bash("git pushx")), false);
  assert.equal(isApproved(saved, bash("git pull")), false);
});

test("isApproved: a prefix never covers a command that fails the guard", () => {
  const saved = [prefix("bash", "git push")];
  for (const ch of GUARD) {
    assert.equal(isApproved(saved, bash(`git push x${ch}y`)), false, JSON.stringify(ch));
  }
});

test("isApproved: a prefix is bound to its tool", () => {
  const saved = [prefix("bash", "git push")];
  const ps = { tool: "powershell", command: "git push", paths: [], rawPaths: [] };
  assert.equal(isApproved(saved, ps), false);
  assert.equal(isApproved(saved, { tool: "bash", paths: [], rawPaths: [] }), false);
});

test("isApproved: an exact approval covers only the same request", () => {
  const req = bash("git push origin main");
  const exact: Approval = {
    kind: "exact",
    tool: "bash",
    value: requestKey(req),
    description: "x",
    cwd: "/repo",
  };
  assert.equal(isApproved([exact], req), true);
  assert.equal(isApproved([exact], bash("git push origin dev")), false);
});

test("restoreApprovals: keeps well-formed entries for this cwd, in order", () => {
  const a = prefix("bash", "git push");
  const b = { ...prefix("bash", "npm run"), kind: "exact" as const };
  assert.deepEqual(restoreApprovals([entry(a), { type: "message" }, entry(b)], "/repo"), [a, b]);
});

test("restoreApprovals: ignores malformed, foreign and other-cwd entries", () => {
  const good = prefix("bash", "git push");
  const bad = [
    entry(good, "pi-kit-rewind-record"),
    entry({ ...good, cwd: "/other" }),
    entry({ ...good, kind: "rule" }),
    entry({ ...good, value: 1 }),
    entry({ kind: "prefix", tool: "bash", value: "git push" }),
    entry(null),
    entry("git push"),
    null,
    "x",
  ];
  assert.deepEqual(restoreApprovals(bad, "/repo"), []);
});

test("isApproved: leading whitespace bash does not strip is part of the command name", () => {
  const saved = [prefix("bash", "git push")];
  for (const lead of [" ", "﻿", " "]) {
    assert.equal(isApproved(saved, bash(`${lead}git push x`)), false, JSON.stringify(lead));
    assert.equal(commandPrefix(`${lead}git push x`), undefined, JSON.stringify(lead));
  }
});
