#!/bin/sh
# Exercise package artifact checks with isolated fixtures and no Pi installation.
set -eu
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
node --input-type=module - "$work" <<'NODE'
import assert from "node:assert/strict";
import { cpSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const work = process.argv[2];
const repo = process.cwd();
const version = JSON.parse(readFileSync("packages/shared/package.json", "utf8")).version;
const manifest = (root, change) => {
  const path = join(root, "package.json");
  const pkg = JSON.parse(readFileSync(path, "utf8"));
  change(pkg);
  writeFileSync(path, JSON.stringify(pkg));
};
const fixture = (name) => {
  const base = join(work, name, "@pi-kit");
  mkdirSync(base, { recursive: true });
  for (const short of ["shared", "rewind", "permissions"]) {
    cpSync(join(repo, "packages", short), join(base, short), {
      recursive: true,
      filter: (path) => !path.split("/").includes("node_modules"),
    });
    if (short !== "shared") {
      manifest(join(base, short), (pkg) => { pkg.dependencies["@pi-kit/shared"] = version; });
    }
  }
  return base;
};
const validate = (root, workspace, failure) => {
  const result = spawnSync(process.execPath, ["scripts/assert-package.mjs", root, workspace], { encoding: "utf8" });
  assert.ifError(result.error);
  assert.equal(result.status, failure ? 1 : 0, result.stderr);
  assert.ok((failure ? result.stderr : result.stdout).includes(failure ?? "Package validation passed"), result.stderr);
};
const positive = fixture("positive");
for (const short of ["shared", "rewind", "permissions"]) {
  validate(join(positive, short), join(repo, "packages", short));
}
const a = fixture("range");
manifest(join(a, "rewind"), (pkg) => { pkg.dependencies["@pi-kit/shared"] = `^${version}`; });
validate(join(a, "rewind"), "packages/rewind", "pinned to an exact version");
const b = fixture("workspace");
const workspace = join(work, "workspace");
cpSync("packages/rewind", join(workspace, "rewind"), { recursive: true, filter: (path) => !path.split("/").includes("node_modules") });
symlinkSync(resolve("packages/shared"), join(workspace, "shared"));
manifest(join(workspace, "rewind"), (pkg) => { pkg.dependencies["@pi-kit/shared"] = version; });
validate(join(b, "rewind"), join(workspace, "rewind"), "workspace:*");
const c = fixture("bytes");
const path = join(c, "shared/src/path.ts");
writeFileSync(path, Buffer.concat([readFileSync(path), Buffer.from("\n")]));
validate(join(c, "rewind"), "packages/rewind", "shared file differs from the repo: path.ts");
const d = fixture("extension");
manifest(join(d, "rewind"), (pkg) => { delete pkg.pi; });
validate(join(d, "rewind"), "packages/rewind", "pi.extensions is declared");
const files = fixture("files");
writeFileSync(join(files, "shared/src/extra.ts"), "");
validate(join(files, "rewind"), "packages/rewind", "shared file set differs from the repo");
const missing = fixture("missing");
rmSync(join(missing, "shared"), { recursive: true });
validate(join(missing, "rewind"), "packages/rewind", "installed @pi-kit/shared not found");
const exports = fixture("exports");
manifest(join(exports, "shared"), (pkg) => { pkg.exports["./path"] = "../rewind/README.md"; });
validate(join(exports, "shared"), "packages/shared", "exports target exists:");
const malformed = fixture("malformed");
writeFileSync(join(malformed, "rewind/package.json"), "{");
validate(join(malformed, "rewind"), "packages/rewind", "SyntaxError");
console.log("Package fixture checks passed (3 positives, A–D and 4 safety cases)");
NODE
