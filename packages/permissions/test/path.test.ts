import assert from "node:assert/strict";
import { homedir } from "node:os";
import { test } from "node:test";
import { expandHome, isOutsideCwd, matchPath, resolvePath } from "../src/match/path.ts";

const CWD = "/repo";

test("expandHome: expands a bare tilde", () => {
  assert.equal(expandHome("~"), homedir());
});

test("expandHome: expands a tilde prefix", () => {
  assert.equal(expandHome("~/.ssh/id_rsa"), `${homedir()}/.ssh/id_rsa`);
});

test("expandHome: leaves other paths untouched", () => {
  assert.equal(expandHome("src/App.ts"), "src/App.ts");
  assert.equal(expandHome("/etc/hosts"), "/etc/hosts");
});

test("resolvePath: resolves a relative path against cwd", () => {
  assert.equal(resolvePath("src/App.ts", CWD), "/repo/src/App.ts");
});

test("resolvePath: leaves an absolute path absolute", () => {
  assert.equal(resolvePath("/etc/hosts", CWD), "/etc/hosts");
});

test("resolvePath: normalises traversal segments", () => {
  assert.equal(resolvePath("src/../.env", CWD), "/repo/.env");
});

test("resolvePath: strips a leading @ as Pi's tools do", () => {
  assert.equal(resolvePath("@.env", CWD), "/repo/.env");
});

test("resolvePath: converts a file:// URL as Pi's tools do", () => {
  assert.equal(resolvePath("file:///etc/hosts", CWD), "/etc/hosts");
});

test("resolvePath: replaces unicode spaces as Pi's tools do", () => {
  assert.equal(resolvePath("src/a\u00A0b.ts", CWD), "/repo/src/a b.ts");
});

test("matchPath: relative pattern against the raw referenced path", () => {
  assert.equal(matchPath(".env", ".env", "/repo/.env", CWD), true);
});

test("matchPath: relative pattern against the resolved absolute path", () => {
  assert.equal(matchPath("src/*", "./src/App.ts", "/repo/src/App.ts", CWD), true);
});

test("matchPath: absolute pattern against the resolved path", () => {
  assert.equal(matchPath("/repo/src/**", "src/a/b.ts", "/repo/src/a/b.ts", CWD), true);
});

test("matchPath: tilde pattern after home expansion", () => {
  const target = `${homedir()}/.ssh/id_rsa`;
  assert.equal(matchPath("~/.ssh/*", target, target, CWD), true);
});

test("matchPath: does not match an unrelated path", () => {
  assert.equal(matchPath(".env", "src/App.ts", "/repo/src/App.ts", CWD), false);
});

test("isOutsideCwd: cwd itself is inside", () => {
  assert.equal(isOutsideCwd("/repo", CWD), false);
});

test("isOutsideCwd: a descendant is inside", () => {
  assert.equal(isOutsideCwd("/repo/src/App.ts", CWD), false);
});

test("isOutsideCwd: a sibling with a shared prefix is outside", () => {
  assert.equal(isOutsideCwd("/repository/x.ts", CWD), true);
});

test("isOutsideCwd: an unrelated absolute path is outside", () => {
  assert.equal(isOutsideCwd("/etc/hosts", CWD), true);
});
