import assert from "node:assert/strict";
import { homedir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { expandHome, resolvePath } from "../src/path.ts";

const CWD = "/repo";

for (const [name, raw, expected] of [
  ["resolves a relative path against cwd", "src/App.ts", "/repo/src/App.ts"],
  ["leaves an absolute path absolute", "/etc/hosts", "/etc/hosts"],
  ["normalises traversal segments", "src/../.env", "/repo/.env"],
  ["strips a leading @ as Pi's tools do", "@.env", "/repo/.env"],
  ["converts a file:// URL as Pi's tools do", "file:///etc/hosts", "/etc/hosts"],
  ["replaces unicode spaces as Pi's tools do", "src/a\u00A0b.ts", "/repo/src/a b.ts"],
  ["resolves an @ source path", "@src/a.ts", "/repo/src/a.ts"],
  ["resolves a temporary file URL", "file:///tmp/x", "/tmp/x"],
  ["expands a home prefix", "~/x", join(homedir(), "x")],
  ["expands a bare tilde", "~", homedir()],
] as const) {
  test(`resolvePath: ${name}`, () => {
    assert.equal(resolvePath(raw, CWD), expected);
  });
}

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
