#!/bin/sh
# Validate the exact packed tarball before publication or in the CI artifact job.
# Called from the repository root with the path to pack.json.
set -eu

# The pin lives once, in the root package.json; CI's weekly window overrides it.
PI_VERSION=${PI_VERSION:-$(node -p 'require("./package.json").devDependencies["@earendil-works/pi-coding-agent"]')}
repo_root=$(pwd)
metadata=$1

# pnpm emits an object; npm emits a one-element array. Both identify the
# archive with `filename`, so never select a different tarball by glob.
tarball=$(node - "$metadata" <<'NODE'
const { lstatSync, readFileSync } = require("node:fs");
const { dirname, extname, resolve } = require("node:path");
const metadata = resolve(process.argv[2]);
const parsed = JSON.parse(readFileSync(metadata, "utf8"));
const entry = Array.isArray(parsed) && parsed.length === 1 ? parsed[0] : parsed;
if (!entry || typeof entry.filename !== "string" || !entry.filename) {
  throw new Error("pack metadata must name exactly one tarball");
}
const tarball = resolve(dirname(metadata), entry.filename);
if (dirname(tarball) !== dirname(metadata) || extname(tarball) !== ".tgz" || !lstatSync(tarball).isFile()) {
  throw new Error(`pack metadata does not name a regular tarball beside it: ${tarball}`);
}
console.log(tarball);
NODE
)

# Validate the package name before using metadata to select paths or source code.
name=$(node - "$metadata" <<'NODE'
const { readFileSync } = require("node:fs");
const parsed = JSON.parse(readFileSync(process.argv[2], "utf8"));
const entry = Array.isArray(parsed) && parsed.length === 1 ? parsed[0] : parsed;
if (!entry || typeof entry.name !== "string" || !/^@pi-kit\/[a-z0-9]+(?:-[a-z0-9]+)*$/.test(entry.name)) {
  throw new Error("pack metadata must name a safe @pi-kit package");
}
console.log(entry.name);
NODE
)
short=${name#@pi-kit/}
if [ ! -d "$repo_root/packages/$short" ] || [ ! -f "$repo_root/scripts/pack-probe-$short.sh" ]; then
  echo "workspace package or packed probe is missing: $name" >&2
  exit 1
fi

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
mkdir "$work/consumer" "$work/pi-home"
cd "$work/consumer"
npm init -y > "$work/npm.log" 2>&1

# Install pinned Pi first so npm resolves the extension's peer against the
# intended version. Keep every package and binary inside this consumer.
if ! npm install --no-audit --no-fund --save-exact "@earendil-works/pi-coding-agent@${PI_VERSION}" > "$work/npm.log" 2>&1; then
  cat "$work/npm.log" >&2
  exit 1
fi
# Unset at publish, so npm resolves the pinned shared from the registry, as users get it.
set -- "$tarball"
if [ -n "${SHARED_TARBALL:-}" ] && [ "$name" != "@pi-kit/shared" ]; then
  set -- "$@" "$SHARED_TARBALL"
fi
if ! npm install --no-audit --no-fund "$@" > "$work/npm.log" 2>&1; then
  cat "$work/npm.log" >&2
  exit 1
fi

node "$repo_root/scripts/assert-package.mjs" "$work/consumer/node_modules/$name" "$repo_root/packages/$short"

# shellcheck source=/dev/null # Package-specific probe selected and checked above.
. "$repo_root/scripts/pack-probe-$short.sh"
