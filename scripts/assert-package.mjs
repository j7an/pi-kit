#!/usr/bin/env node
/** Assert the published shape of an installed @pi-kit/permissions package. */
import { existsSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

const argument = process.argv[2];
const root = argument && resolve(argument);
if (!root || !existsSync(root) || !statSync(root).isDirectory()) {
  console.error(`not a directory: ${argument ?? "(missing)"}`);
  process.exit(1);
}

const failures = [];
const check = (label, condition) => {
  if (!condition) failures.push(label);
};

const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
check("name is @pi-kit/permissions", pkg.name === "@pi-kit/permissions");
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
  pkg.repository?.directory === "packages/permissions",
);

check("dependencies is empty", Object.keys(pkg.dependencies ?? {}).length === 0);
check("optionalDependencies is empty", Object.keys(pkg.optionalDependencies ?? {}).length === 0);
check(
  "peerDependencies has exactly the two Pi-bundled packages",
  JSON.stringify(Object.keys(pkg.peerDependencies ?? {}).sort()) ===
    JSON.stringify(["@earendil-works/pi-coding-agent", "typebox"]),
);
check(
  "pi-coding-agent peer range is *",
  pkg.peerDependencies?.["@earendil-works/pi-coding-agent"] === "*",
);
check("typebox peer range is *", pkg.peerDependencies?.typebox === "*");

const extensions = pkg.pi?.extensions;
check("pi.extensions is declared", Array.isArray(extensions) && extensions.length > 0);
for (const entry of Array.isArray(extensions) ? extensions : []) {
  check(
    `pi.extensions entry exists: ${entry}`,
    typeof entry === "string" && existsSync(join(root, entry)),
  );
}
for (const file of ["extensions/index.ts", "src/decide.ts", "README.md", "LICENSE"]) {
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
