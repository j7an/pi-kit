import assert from "node:assert/strict";
import { test } from "node:test";
import { globToRegExp } from "../src/match/glob.ts";

const crossing = (p: string, s: string) => globToRegExp(p, { crossSegment: true }).test(s);
const segmented = (p: string, s: string) => globToRegExp(p, { crossSegment: false }).test(s);

test("anchoring: matches the whole subject, not a prefix", () => {
  assert.equal(segmented("ls", "ls"), true);
  assert.equal(segmented("ls", "ls -la"), false);
});

test("anchoring: escapes regex metacharacters as literals", () => {
  assert.equal(segmented("a.b", "a.b"), true);
  assert.equal(segmented("a.b", "axb"), false);
  assert.equal(segmented("c++", "c++"), true);
});

test("crossSegment: * spans slashes and whitespace", () => {
  assert.equal(crossing("rm -rf *", "rm -rf /tmp/x"), true);
  assert.equal(crossing("git push --force*", "git push --force-with-lease"), true);
  assert.equal(crossing("npm publish*", "npm publish --dry-run"), true);
});

test("crossSegment: does not match a different command", () => {
  assert.equal(crossing("rm -rf *", "rmdir /tmp"), false);
});

test("crossSegment: * spans a newline, which quoting keeps inside one segment", () => {
  assert.equal(crossing("rm -rf *", 'rm -rf "a\nb"'), true);
});

test("segmented: * stays within one path segment", () => {
  assert.equal(segmented("src/*", "src/App.ts"), true);
  assert.equal(segmented("src/*", "src/a/b.ts"), false);
});

test("segmented: ** crosses segments", () => {
  assert.equal(segmented(".github/**", ".github/workflows/ci.yml"), true);
  assert.equal(segmented("/repo/src/**", "/repo/src/deep/x.ts"), true);
});

test("segmented: ** does not match the bare parent directory", () => {
  assert.equal(segmented(".github/**", ".github"), false);
});

test("segmented: leading **/ also matches a bare filename", () => {
  assert.equal(segmented("**/*.env", "a/b/x.env"), true);
  assert.equal(segmented("**/*.env", "x.env"), true);
});

test("segmented: **/ spans whole segments, so it does not swallow an unrelated basename", () => {
  assert.equal(segmented("**/.env", ".env"), true);
  assert.equal(segmented("**/.env", "src/.env"), true);
  assert.equal(segmented("**/.env", "foo.env"), false);
  assert.equal(segmented("**/.env", "src/foo.env"), false);
});

test("segmented: a bare filename pattern does not match it in a subdirectory", () => {
  assert.equal(segmented(".env", ".env"), true);
  assert.equal(segmented(".env", "src/.env"), false);
  assert.equal(segmented(".env*", ".env.local"), true);
});
