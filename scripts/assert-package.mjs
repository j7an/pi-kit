#!/usr/bin/env node
/** Assert the published shape of an installed workspace package. */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
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
check(
  "repository points at the GitHub repo",
  pkg.repository?.url?.includes("github.com/j7an/pi-kit"),
);
check(
  "repository.directory names the workspace package",
  pkg.repository?.directory === workspace.repository?.directory &&
    pkg.repository?.directory === `packages/${workspace.name.slice("@pi-kit/".length)}`,
);

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

const isLibrary = workspace.name === "@pi-kit/shared";
const safePath = (entry) =>
  typeof entry === "string" &&
  !entry.includes("\\") &&
  !entry.includes("\0") &&
  /^(?:\.\/)?[^/]+(?:\/[^/]+)*$/.test(entry) &&
  entry
    .replace(/^\.\//, "")
    .split("/")
    .every((part) => part !== "." && part !== "..");

if (isLibrary) {
  check("library has no pi key", pkg.pi === undefined);
  check("library has no pi-package keyword", !pkg.keywords?.includes("pi-package"));
  check("dependencies is empty", Object.keys(pkg.dependencies ?? {}).length === 0);
  const targets = Object.values(pkg.exports ?? {});
  check("exports is declared", targets.length > 0);
  for (const target of targets) {
    check(`exports target exists: ${target}`, safePath(target) && existsSync(join(root, target)));
  }
} else {
  check("keywords include pi-package", pkg.keywords?.includes("pi-package"));
  for (const [name, version] of Object.entries(pkg.dependencies ?? {})) {
    check(`${name} dependency is allowed`, name === "@pi-kit/shared");
    check(
      `${name} is pinned to an exact version`,
      typeof version === "string" && /^\d+\.\d+\.\d+$/.test(version),
    );
  }
  for (const [name, version] of Object.entries(workspace.dependencies ?? {})) {
    if (name.startsWith("@pi-kit/")) {
      check(`${name} workspace dependency is workspace:*`, version === "workspace:*");
    }
  }
  if (Object.hasOwn(pkg.dependencies ?? {}, "@pi-kit/shared")) {
    const shared = [join(root, "node_modules/@pi-kit/shared"), join(root, "../shared")].find(
      existsSync,
    );
    check("installed @pi-kit/shared not found", shared !== undefined);
    if (shared) {
      const installedSrc = join(shared, "src");
      const workspaceSrc = join(workspaceRoot, "../shared/src");
      const files = (dir) =>
        readdirSync(dir, { recursive: true })
          .filter((file) => statSync(join(dir, file)).isFile())
          .sort();
      const installedFiles = files(installedSrc);
      const workspaceFiles = files(workspaceSrc);
      check(
        "shared file set differs from the repo",
        JSON.stringify(installedFiles) === JSON.stringify(workspaceFiles),
      );
      for (const file of workspaceFiles) {
        if (installedFiles.includes(file)) {
          check(
            `shared file differs from the repo: ${file}`,
            readFileSync(join(installedSrc, file)).equals(readFileSync(join(workspaceSrc, file))),
          );
        }
      }
    }
  }
  const extensions = pkg.pi?.extensions;
  check("pi.extensions is declared", Array.isArray(extensions) && extensions.length > 0);
  for (const entry of Array.isArray(extensions) ? extensions : []) {
    check(`pi.extensions entry exists: ${entry}`, safePath(entry) && existsSync(join(root, entry)));
  }
  check("file present: extensions/index.ts", existsSync(join(root, "extensions/index.ts")));
}
for (const file of ["README.md", "LICENSE"]) {
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
