#!/usr/bin/env node
/**
 * Write CHANGELOG.md for the package in the working directory, from its release tags.
 * Pi shows the entries after an update. Same range, paths and commit filter as the
 * GitHub release notes (shared-workflows scoped-release-notes.sh), so the two agree.
 */
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";

const REPO_URL = "https://github.com/j7an/pi-kit";

const root = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
// The paths are repository-relative and git resolves pathspecs against its working directory.
const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
const lines = (text) => text.split("\n").filter(Boolean);

// Without tags a released package would get a first-release entry and pass the publish gate.
if (git("rev-parse", "--is-shallow-repository") === "true") {
  throw new Error("changelog needs full history and tags; check out with fetch-depth: 0");
}

const short = basename(process.cwd());
const workflow = join(root, ".github/workflows", `publish-${short}.yml`);
// The release notes are scoped by this input, so read it instead of keeping a copy.
const paths = readFileSync(workflow, "utf8").match(/^\s*paths:\s*"([^"]+)"\s*$/m)?.[1];
if (!paths) throw new Error(`no paths: "..." line in ${workflow}`);

const tags = lines(git("tag", "-l", `${short}/v*`, "--merged", "HEAD"))
  .map((tag) => ({ tag, version: tag.slice(`${short}/v`.length) }))
  .filter(({ version }) => /^\d+\.\d+\.\d+$/.test(version))
  .map((entry) => ({ ...entry, parts: entry.version.split(".").map(Number) }))
  .sort((a, b) => a.parts[0] - b.parts[0] || a.parts[1] - b.parts[1] || a.parts[2] - b.parts[2]);

const FIRST = "- First release.";
const entries = tags.map(({ tag, version }, index) => {
  const date = git("log", "-1", "--format=%cs", tag);
  // A git setting such as log.showSignature adds lines here; refuse them rather than publish them.
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error(`unexpected date for ${tag}: ${date}`);
  const heading = `## [${version}] - ${date}`;
  if (index === 0) return `${heading}\n\n${FIRST}`;
  // ponytail: version order equals ancestry here because tag-release always tags main's
  // head with the next version; pick the nearest ancestor tag instead if release branches appear.
  const range = `${tags[index - 1].tag}..${tag}`;
  // Squash merges only, by their trailing "(#N)": the release notes list pull requests.
  const bullets = lines(git("log", "--reverse", "--format=%s", range, "--", ...paths.split(/\s+/)))
    .map((subject) => subject.match(/^(.*) \(#(\d+)\)$/))
    .filter(Boolean)
    .map(([, text, pr]) => `- ${text} ([#${pr}](${REPO_URL}/pull/${pr}))`);
  const body = bullets.length
    ? bullets.join("\n")
    : "- No pull requests in this release touched this package.";
  return `${heading}\n\n${body}`;
});
if (entries.length === 0) {
  // Never released: keep a new package's packed artifact valid before its first tag exists.
  const { version } = JSON.parse(readFileSync("package.json", "utf8"));
  entries.push(`## [${version}]\n\n${FIRST}`);
}

writeFileSync("CHANGELOG.md", `# Changelog\n\n${entries.reverse().join("\n\n")}\n`);
