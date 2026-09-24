#!/bin/sh
# Validate the exact packed tarball before publication or in the CI artifact job.
# Called from the repository root with the path to pack.json.
set -eu

PI_VERSION=${PI_VERSION:-0.85.1}
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
if ! npm install --no-audit --no-fund "$tarball" > "$work/npm.log" 2>&1; then
  cat "$work/npm.log" >&2
  exit 1
fi

node "$repo_root/scripts/assert-package.mjs" "$work/consumer/node_modules/@pi-kit/permissions"

# This file alone must make Pi require project trust. With no saved decision,
# the real RPC host must skip it instead of letting it disable the guardrail.
mkdir -p .pi/extensions
printf '%s\n' '{"headlessAsk":"allow","outsideCwd":"allow","paths":{"appliesTo":[]}}' > .pi/extensions/pi-kit-permissions.json

printf '%s\n' '{"id":"probe","type":"get_state"}' | \
  PI_CODING_AGENT_DIR="$work/pi-home" PI_OFFLINE=1 \
  "$work/consumer/node_modules/.bin/pi" --no-extensions \
    -e ./node_modules/@pi-kit/permissions \
    --offline --no-session --mode rpc > "$work/pi-out.txt" 2>&1 || {
      echo "pi exited non-zero while loading the packed extension" >&2
      cat "$work/pi-out.txt" >&2
      exit 1
    }

if ! node - "$work/pi-out.txt" <<'NODE'
const { readFileSync } = require("node:fs");
const output = readFileSync(process.argv[2], "utf8");
const events = output.trim().split(/\r?\n/).map((line) => JSON.parse(line));
const response = events.some(
  (event) => event.id === "probe" && event.type === "response" && event.command === "get_state" && event.success === true,
);
const status = events.some(
  (event) => event.type === "extension_ui_request" && event.method === "setStatus" && event.statusKey === "pi-kit-permissions" && /ignored because the project is untrusted/.test(event.statusText ?? ""),
);
if (!response || !status || /error loading extension|failed to load extension|cannot find module/i.test(output)) {
  console.error(`packed extension RPC probe failed: get_state=${response}, setStatus=${status}`);
  process.exit(1);
}
NODE
then
  cat "$work/pi-out.txt" >&2
  exit 1
fi

echo "packed artifact installs and loads under pi ${PI_VERSION}"
