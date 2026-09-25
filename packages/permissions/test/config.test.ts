import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_CONFIG } from "../src/config/defaults.ts";
import {
  globalConfigPath,
  loadConfig,
  mergeConfig,
  projectConfigPath,
} from "../src/config/load.ts";

const AGENT_DIR = "/home/u/.pi/agent";
const CONFIG_DIR = ".pi";
const CWD = "/repo";
const GLOBAL = globalConfigPath(AGENT_DIR);
const PROJECT = projectConfigPath(CWD, CONFIG_DIR);

/**
 * Drives loadConfig against an in-memory filesystem and records every path
 * whose CONTENTS were read, so tests can assert what was never opened.
 */
const load = (opts: { trusted?: boolean; files?: Record<string, string> }) => {
  const map = opts.files ?? {};
  const reads: string[] = [];
  const result = loadConfig({
    cwd: CWD,
    agentDir: AGENT_DIR,
    configDirName: CONFIG_DIR,
    trusted: opts.trusted ?? true,
    exists: (p) => Object.hasOwn(map, p),
    readFile: (p) => {
      reads.push(p);
      return Object.hasOwn(map, p) ? map[p] : undefined;
    },
  });
  return { ...result, reads };
};

// --- paths -----------------------------------------------------------------

test("paths: global config is a flat file under <agentDir>/extensions", () => {
  assert.equal(GLOBAL, "/home/u/.pi/agent/extensions/pi-kit-permissions.json");
});

test("paths: project config lives under Pi's trust-protected extensions directory", () => {
  assert.equal(PROJECT, "/repo/.pi/extensions/pi-kit-permissions.json");
  // A rebranded Pi changes the directory name; nothing here hardcodes `.pi`.
  assert.equal(projectConfigPath(CWD, ".tau"), "/repo/.tau/extensions/pi-kit-permissions.json");
});

// --- mergeConfig -----------------------------------------------------------

test("mergeConfig: unions rule lists and deduplicates", () => {
  const merged = mergeConfig(
    { bash: { deny: ["a", "b"], ask: ["x"] } },
    { bash: { deny: ["b", "c"], allow: ["y"] } },
  );
  assert.deepEqual(merged.bash, { deny: ["a", "b", "c"], ask: ["x"], allow: ["y"] });
});

test("mergeConfig: a patch never removes an inherited rule", () => {
  const merged = mergeConfig({ paths: { deny: [".env"] } }, { paths: { deny: [] } });
  assert.deepEqual(merged.paths?.deny, [".env"]);
});

test("mergeConfig: scalars overwrite", () => {
  const merged = mergeConfig(
    { defaultMode: "deny", headlessAsk: "deny", outsideCwd: "deny" },
    { defaultMode: "allow", outsideCwd: "ask" },
  );
  assert.equal(merged.defaultMode, "allow");
  assert.equal(merged.headlessAsk, "deny");
  assert.equal(merged.outsideCwd, "ask");
});

test("mergeConfig: appliesTo overwrites rather than unions", () => {
  const merged = mergeConfig(
    { paths: { appliesTo: ["write", "edit"] } },
    { paths: { appliesTo: ["read"] } },
  );
  assert.deepEqual(merged.paths?.appliesTo, ["read"]);
});

test("mergeConfig: keys the patch omits are inherited untouched", () => {
  const merged = mergeConfig(
    { bash: { deny: ["a"] }, tools: { ask: ["*"] } },
    { bash: { ask: ["b"] } },
  );
  assert.deepEqual(merged.tools, { ask: ["*"] });
  assert.deepEqual(merged.bash, { deny: ["a"], ask: ["b"] });
});

// --- loadConfig ------------------------------------------------------------

test("loadConfig: returns defaults when no config file exists", () => {
  const result = load({});
  assert.deepEqual(result.config, DEFAULT_CONFIG);
  assert.deepEqual(result.problems, []);
  assert.equal(result.forcedAsk, false);
});

test("loadConfig: a global scope adds to the default deny list", () => {
  const result = load({ files: { [GLOBAL]: JSON.stringify({ bash: { deny: ["curl *"] } }) } });
  assert.deepEqual(result.config.bash?.deny, [...DEFAULT_CONFIG.bash.deny, "curl *"]);
  // The default ask list survives: lists are unioned, never replaced.
  assert.deepEqual(result.config.bash?.ask, DEFAULT_CONFIG.bash.ask);
});

test("loadConfig: default → global → project, in that order", () => {
  const result = load({
    files: {
      [GLOBAL]: JSON.stringify({ bash: { deny: ["g"] }, defaultMode: "deny" }),
      [PROJECT]: JSON.stringify({ bash: { deny: ["p"] }, defaultMode: "ask" }),
    },
  });
  assert.deepEqual(result.config.bash?.deny, [...DEFAULT_CONFIG.bash.deny, "g", "p"]);
  assert.equal(result.config.defaultMode, "ask");
});

test("loadConfig: a project cannot remove a global deny", () => {
  const result = load({
    files: {
      [GLOBAL]: JSON.stringify({ bash: { deny: ["curl *"] } }),
      [PROJECT]: JSON.stringify({ bash: { deny: [], allow: ["curl *"] } }),
    },
  });
  assert.ok(result.config.bash?.deny?.includes("curl *"));
});

test("loadConfig: ignores project config when the project is untrusted", () => {
  const result = load({
    trusted: false,
    files: {
      [GLOBAL]: JSON.stringify({ outsideCwd: "deny" }),
      [PROJECT]: JSON.stringify({ outsideCwd: "allow" }),
    },
  });
  assert.equal(result.config.outsideCwd, "deny");
  assert.match(result.problems.join("\n"), /untrusted/);
  // A skip is not a malformed scope.
  assert.equal(result.forcedAsk, false);
  assert.equal(result.config.defaultMode, "allow");
});

test("loadConfig: never reads the contents of an untrusted project config", () => {
  const result = load({
    trusted: false,
    files: { [PROJECT]: JSON.stringify({ outsideCwd: "allow" }) },
  });
  assert.ok(!result.reads.includes(PROJECT));
});

test("loadConfig: malformed JSON contributes no rules, reports its path, and forces ask", () => {
  const result = load({ files: { [GLOBAL]: "{ not json" } });
  assert.deepEqual(result.config.bash, DEFAULT_CONFIG.bash);
  assert.match(result.problems.join("\n"), new RegExp(GLOBAL));
  assert.equal(result.forcedAsk, true);
  assert.equal(result.config.defaultMode, "ask");
});

test("loadConfig: a schema violation reports the offending key and forces ask", () => {
  const result = load({ files: { [GLOBAL]: JSON.stringify({ defaultMode: "sometimes" }) } });
  assert.match(result.problems.join("\n"), /\/defaultMode/);
  assert.equal(result.forcedAsk, true);
  assert.equal(result.config.defaultMode, "ask");
});

test("loadConfig: forced ask outranks a valid scope's defaultMode", () => {
  const result = load({
    files: {
      [GLOBAL]: JSON.stringify({ defaultMode: "allow" }),
      [PROJECT]: "{ not json",
    },
  });
  assert.equal(result.config.defaultMode, "ask");
  assert.equal(result.forcedAsk, true);
});

test("loadConfig: a malformed project scope leaves global rules in force", () => {
  const result = load({
    files: {
      [GLOBAL]: JSON.stringify({ bash: { deny: ["curl *"] } }),
      [PROJECT]: "{ not json",
    },
  });
  assert.ok(result.config.bash?.deny?.includes("curl *"));
  // The parse error plus the forced-ask notice.
  assert.equal(result.problems.length, 2);
});

test("loadConfig: a malformed global scope leaves project rules in force", () => {
  const result = load({
    files: {
      [GLOBAL]: "{ not json",
      [PROJECT]: JSON.stringify({ bash: { deny: ["curl *"] } }),
    },
  });
  assert.ok(result.config.bash?.deny?.includes("curl *"));
  assert.equal(result.problems.length, 2);
});

test("loadConfig: a readFile that throws is a malformed scope", () => {
  const result = loadConfig({
    cwd: CWD,
    agentDir: AGENT_DIR,
    configDirName: CONFIG_DIR,
    trusted: true,
    exists: () => true,
    readFile: () => {
      throw new Error("EACCES");
    },
  });
  assert.equal(result.forcedAsk, true);
  assert.match(result.problems.join("\n"), /EACCES/);
});

test("loadConfig: malformed scope denies headless asks despite a valid sibling allowing them", () => {
  const result = load({
    files: {
      [GLOBAL]: JSON.stringify({ headlessAsk: "allow", bash: { deny: ["curl *"] } }),
      [PROJECT]: "{ not json",
    },
  });
  assert.equal(result.forcedAsk, true);
  assert.equal(result.config.defaultMode, "ask");
  assert.equal(result.config.headlessAsk, "deny");
  assert.ok(result.config.bash?.deny?.includes("curl *"));
});
