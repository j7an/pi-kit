#!/usr/bin/env node
/** Assert the published shape of an installed workspace package. */
import { existsSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

const argument = process.argv[2];
const root = argument && resolve(argument);
if (!root || !existsSync(root) || !statSync(root).isDirectory()) {
  console.error(`not a directory: ${argument ?? "(missing)"}`);
  process.exit(1);
}

const workspaceArgument = process.argv[3];
const workspaceRoot = workspaceArgument && resolve(workspaceArgument);
if (!workspaceRoot || !existsSync(workspaceRoot) || !statSync(workspaceRoot).isDirectory()) {
  console.error(`not a directory: ${workspaceArgument ?? "(missing)"}`);
  process.exit(1);
}
const workspace = JSON.parse(readFileSync(join(workspaceRoot, "package.json"), "utf8"));
if (
  typeof workspace.name !== "string" ||
  !/^@pi-kit\/[a-z0-9]+(?:-[a-z0-9]+)*$/.test(workspace.name)
) {
  console.error("workspace name must be a safe @pi-kit package name");
  process.exit(1);
}

const failures = [];
const check = (label, condition) => {
  if (!condition) failures.push(label);
};

const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
check("name matches the workspace package", pkg.name === workspace.name);
check("type is module", pkg.type === "module");
check("publishConfig.access is public", pkg.publishConfig?.access === "public");
check("engines.node is a >= semver range", /^>=\d+\.\d+\.\d+$/.test(pkg.engines?.node ?? ""));
check("keywords include pi-package", pkg.keywords?.includes("pi-package"));
check(
  "repository points at the GitHub repo",
  pkg.repository?.url?.includes("github.com/j7an/pi-kit"),
);
check(
  "repository.directory names the workspace package",
  pkg.repository?.directory === workspace.repository?.directory &&
    pkg.repository?.directory === `packages/${workspace.name.slice("@pi-kit/".length)}`,
);

check("dependencies is empty", Object.keys(pkg.dependencies ?? {}).length === 0);
check("optionalDependencies is empty", Object.keys(pkg.optionalDependencies ?? {}).length === 0);
const peers = Object.keys(pkg.peerDependencies ?? {}).sort();
check(
  "peerDependencies matches the workspace package",
  JSON.stringify(peers) === JSON.stringify(Object.keys(workspace.peerDependencies ?? {}).sort()),
);
// Pi supplies these and never installs peers for extensions; optional stops
// plain npm installs from pulling the Pi host tree.
for (const name of peers) {
  check(
    `${name} peer is supplied by Pi`,
    ["@earendil-works/pi-coding-agent", "@earendil-works/pi-tui", "typebox"].includes(name),
  );
  check(`${name} peer range is *`, pkg.peerDependencies[name] === "*");
  check(`${name} peer is optional`, pkg.peerDependenciesMeta?.[name]?.optional === true);
}

const extensions = pkg.pi?.extensions;
check("pi.extensions is declared", Array.isArray(extensions) && extensions.length > 0);
for (const entry of Array.isArray(extensions) ? extensions : []) {
  check(
    `pi.extensions entry exists: ${entry}`,
    typeof entry === "string" &&
      !entry.includes("\\") &&
      !entry.includes("\0") &&
      /^(?:\.\/)?[^/]+(?:\/[^/]+)*$/.test(entry) &&
      entry
        .replace(/^\.\//, "")
        .split("/")
        .every((part) => part !== "." && part !== "..") &&
      existsSync(join(root, entry)),
  );
}
for (const file of ["extensions/index.ts", "README.md", "LICENSE"]) {
  check(`file present: ${file}`, existsSync(join(root, file)));
}
check("no dist/ directory was published", !existsSync(join(root, "dist")));
check("no node_modules was published", !existsSync(join(root, "node_modules")));

if (failures.length > 0) {
  console.error("Package validation FAILED:");
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}
console.log(`Package validation passed (${root})`);
