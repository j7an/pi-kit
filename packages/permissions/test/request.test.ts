import assert from "node:assert/strict";
import { test } from "node:test";
import { toRequest } from "../src/request.ts";

const CWD = "/repo";

for (const tool of ["bash", "powershell"]) {
  test(`${tool}: captures the command and carries no paths`, () => {
    assert.deepEqual(toRequest(tool, { command: "rm -rf /tmp" }, CWD), {
      tool,
      command: "rm -rf /tmp",
      paths: [],
      rawPaths: [],
    });
  });

  test(`${tool}: tolerates a missing command`, () => {
    assert.equal(toRequest(tool, {}, CWD).command, "");
  });
}

for (const tool of ["read", "write", "edit"]) {
  test(`${tool}: resolves the required path`, () => {
    const req = toRequest(tool, { path: "src/App.ts" }, CWD);
    assert.equal(req.tool, tool);
    assert.deepEqual(req.rawPaths, ["src/App.ts"]);
    assert.deepEqual(req.paths, ["/repo/src/App.ts"]);
    assert.equal(req.command, undefined);
  });
}

test("read: keeps an absolute path absolute", () => {
  assert.deepEqual(toRequest("read", { path: "/etc/hosts" }, CWD).paths, ["/etc/hosts"]);
});

for (const tool of ["ls", "grep", "find"]) {
  test(`${tool}: defaults to the working directory when path is absent`, () => {
    const req = toRequest(tool, {}, CWD);
    assert.deepEqual(req.rawPaths, ["."]);
    assert.deepEqual(req.paths, ["/repo"]);
  });

  test(`${tool}: uses the supplied path when present`, () => {
    assert.deepEqual(toRequest(tool, { path: "src" }, CWD).paths, ["/repo/src"]);
  });
}

test("unknown tool: produces a path-less request", () => {
  assert.deepEqual(toRequest("deploy", { target: "prod" }, CWD), {
    tool: "deploy",
    paths: [],
    rawPaths: [],
  });
});

test("non-string path is treated as absent", () => {
  assert.deepEqual(toRequest("read", { path: 42 }, CWD).rawPaths, ["."]);
});
