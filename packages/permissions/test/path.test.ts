import assert from "node:assert/strict";
import { homedir } from "node:os";
import { test } from "node:test";
import { isOutsideCwd, matchPath } from "../src/match/path.ts";

const CWD = "/repo";

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
