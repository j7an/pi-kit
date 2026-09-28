#!/usr/bin/env node
/** Print the Pi versions the weekly CI job tests, as a GitHub Actions output line. */
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * The newest patch of the newest Pi minor, plus the newest patch of every minor
 * that a newer minor replaced within the last 30 days. A minor counts as replaced
 * when the next minor first published; Pi backports patches and sometimes skips `.0`.
 */
export function piWindow(time, now) {
  const minors = new Map();
  for (const [version, published] of Object.entries(time)) {
    const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
    if (!match) continue;
    const [major, minor, patch] = match.slice(1).map(Number);
    const at = Date.parse(published);
    const key = `${major}.${minor}`;
    const entry = minors.get(key) ?? { major, minor, patch, version, first: at };
    if (patch >= entry.patch) Object.assign(entry, { patch, version });
    entry.first = Math.min(entry.first, at);
    minors.set(key, entry);
  }
  const ordered = [...minors.values()].sort((a, b) => b.major - a.major || b.minor - a.minor);
  const versions = ordered
    .filter((_, index) => index === 0 || now - ordered[index - 1].first <= WINDOW_MS)
    .map((entry) => entry.version);
  if (versions.length < 2) {
    throw new Error(`Pi window has ${versions.length} version(s); expected at least 2`);
  }
  return versions;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const output = execFileSync(
    "npm",
    ["view", "@earendil-works/pi-coding-agent", "time", "--json"],
    { encoding: "utf8" },
  );
  const parsed = JSON.parse(output);
  // npm 12 wraps the field in a one-element array; older npm prints the object.
  const time = Array.isArray(parsed) && parsed.length === 1 ? parsed[0] : parsed;
  console.log(`versions=${JSON.stringify(piWindow(time, Date.now()))}`);
}
