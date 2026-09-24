import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_CONFIG } from "../src/config/defaults.ts";
import type { Config } from "../src/config/schema.ts";
import { decide, type PermissionRequest } from "../src/decide.ts";

const CWD = "/repo";

const bash = (command: string): PermissionRequest => ({
  tool: "bash",
  command,
  paths: [],
  rawPaths: [],
});

const file = (tool: string, raw: string, resolved: string): PermissionRequest => ({
  tool,
  paths: [resolved],
  rawPaths: [raw],
});

const base: Config = { defaultMode: "allow", outsideCwd: "allow" };

// --- defaults ------------------------------------------------------------

test("falls through to defaultMode when nothing matches", () => {
  assert.equal(decide(base, bash("ls -la"), CWD).outcome, "allow");
});

test("honours a restrictive defaultMode", () => {
  assert.equal(decide({ ...base, defaultMode: "deny" }, bash("ls"), CWD).outcome, "deny");
});

test("a defaultMode outcome carries no dimension", () => {
  assert.equal(decide({ ...base, defaultMode: "ask" }, bash("ls"), CWD).dimension, undefined);
});

// --- within-dimension ordering -------------------------------------------

const ordered: Config = { ...base, bash: { deny: ["rm -rf *"], ask: ["rm *"], allow: ["*"] } };

test("checks deny before ask before allow", () => {
  assert.equal(decide(ordered, bash("rm -rf /tmp"), CWD).outcome, "deny");
  assert.equal(decide(ordered, bash("rm /tmp/x"), CWD).outcome, "ask");
  assert.equal(decide(ordered, bash("ls"), CWD).outcome, "allow");
});

test("reports the dimension and pattern that matched", () => {
  const decision = decide(ordered, bash("rm -rf /tmp"), CWD);
  assert.equal(decision.dimension, "bash");
  assert.equal(decision.pattern, "rm -rf *");
});

test("specificity does not change order: a broad deny beats a narrow allow", () => {
  const config: Config = { ...base, bash: { deny: ["git *"], allow: ["git status"] } };
  assert.equal(decide(config, bash("git status"), CWD).outcome, "deny");
});

// --- compound commands ---------------------------------------------------

for (const command of ["# it's stale\nrm -rf dist", "npm test # don't cache\ngit push --force"]) {
  test(`comments cannot hide a denied command: ${JSON.stringify(command)}`, () => {
    assert.equal(decide(DEFAULT_CONFIG, bash(command), CWD).outcome, "deny");
  });
}

for (const mode of ["deny", "ask"] as const) {
  test(`segment attribution survives a matching ${mode} default`, () => {
    assert.deepEqual(
      decide(
        { ...base, defaultMode: mode, bash: { [mode]: ["rm -rf *"] } },
        bash("cd build && rm -rf ."),
        CWD,
      ),
      {
        outcome: mode,
        dimension: "bash",
        pattern: "rm -rf *",
        segment: "rm -rf .",
      },
    );
  });
}

test("an equally restrictive whole-request rule keeps attribution", () => {
  assert.deepEqual(
    decide(
      { ...base, tools: { deny: ["bash"] }, bash: { deny: ["rm -rf *"] } },
      bash("cd build && rm -rf ."),
      CWD,
    ),
    {
      outcome: "deny",
      dimension: "tools",
      pattern: "bash",
    },
  );
});

test("a deny pattern catches a later segment of a compound command", () => {
  const config: Config = { ...base, bash: { deny: ["rm -rf *"] } };
  const decision = decide(config, bash("cd build && rm -rf ."), CWD);
  assert.equal(decision.outcome, "deny");
  assert.equal(decision.segment, "rm -rf .");
});

test("segment is omitted when the whole command matched", () => {
  const config: Config = { ...base, bash: { deny: ["rm -rf *"] } };
  assert.equal(decide(config, bash("rm -rf dist"), CWD).segment, undefined);
});

test("an allow on one segment does not rescue a deny on another", () => {
  const config: Config = { ...base, bash: { deny: ["git push --force*"], allow: ["git *"] } };
  assert.equal(decide(config, bash("git fetch && git push --force"), CWD).outcome, "deny");
});

test("a quoted operator does not create a matchable segment", () => {
  const config: Config = { ...base, bash: { deny: ["rm -rf *"] } };
  assert.equal(decide(config, bash('echo "cd x && rm -rf y"'), CWD).outcome, "allow");
});

// --- an explicit match beats defaultMode ---------------------------------

test("allows an explicitly allowed command under a deny default", () => {
  const config: Config = { ...base, defaultMode: "deny", bash: { allow: ["git status*"] } };
  assert.equal(decide(config, bash("git status --short"), CWD).outcome, "allow");
  assert.equal(decide(config, bash("git push"), CWD).outcome, "deny");
});

// --- tools dimension -----------------------------------------------------

test("tools: matches on tool name", () => {
  const config: Config = { ...base, tools: { deny: ["write"] } };
  assert.equal(decide(config, file("write", "a.txt", "/repo/a.txt"), CWD).outcome, "deny");
  assert.equal(decide(config, file("read", "a.txt", "/repo/a.txt"), CWD).outcome, "allow");
});

test("tools: supports a wildcard", () => {
  const config: Config = { ...base, tools: { ask: ["*"] } };
  assert.equal(decide(config, bash("ls"), CWD).outcome, "ask");
});

// --- paths dimension -----------------------------------------------------

const pathed: Config = {
  ...base,
  paths: { appliesTo: ["write", "edit"], deny: [".env"], ask: ["src/**"] },
};

test("paths: gates a tool listed in appliesTo", () => {
  assert.equal(decide(pathed, file("write", ".env", "/repo/.env"), CWD).outcome, "deny");
});

test("paths: does not gate a tool absent from appliesTo", () => {
  assert.equal(decide(pathed, file("read", ".env", "/repo/.env"), CWD).outcome, "allow");
});

test("paths: appliesTo defaults to write and edit", () => {
  const noAppliesTo: Config = { ...base, paths: { deny: [".env"] } };
  assert.equal(decide(noAppliesTo, file("edit", ".env", "/repo/.env"), CWD).outcome, "deny");
  assert.equal(decide(noAppliesTo, file("read", ".env", "/repo/.env"), CWD).outcome, "allow");
});

test("paths: evaluates every path in a request and takes the most restrictive", () => {
  const multi: PermissionRequest = {
    tool: "write",
    paths: ["/repo/ok.txt", "/repo/.env"],
    rawPaths: ["ok.txt", ".env"],
  };
  assert.equal(decide(pathed, multi, CWD).outcome, "deny");
});

test("bash allow matches the whole command only, so a segment cannot loosen a default deny", () => {
  const config: Config = { ...base, defaultMode: "deny", bash: { allow: ["ls"] } };
  assert.equal(decide(config, bash("ls"), CWD).outcome, "allow");
  assert.equal(decide(config, bash("ls && curl example.com"), CWD).outcome, "deny");
});

test("a whole-command ask can override a deny default", () => {
  const config: Config = { ...base, defaultMode: "deny", bash: { ask: ["ls"] } };
  assert.deepEqual(decide(config, bash("ls"), CWD), {
    outcome: "ask",
    dimension: "bash",
    pattern: "ls",
  });
});

test("a segment-only ask cannot loosen a deny default", () => {
  const config: Config = {
    ...base,
    defaultMode: "deny",
    headlessAsk: "allow",
    bash: { ask: ["ls"] },
  };
  assert.deepEqual(decide(config, bash("echo ready && ls"), CWD), { outcome: "deny" });
});

test("a segment-only ask tightens a whole-command allow", () => {
  const config: Config = {
    ...base,
    defaultMode: "deny",
    bash: { ask: ["ls"], allow: ["echo ready && ls"] },
  };
  assert.deepEqual(decide(config, bash("echo ready && ls"), CWD), {
    outcome: "ask",
    dimension: "bash",
    pattern: "ls",
    segment: "ls",
  });
});

// --- outsideCwd ----------------------------------------------------------

test("outsideCwd: asks when a write leaves the working directory", () => {
  const config: Config = { ...base, outsideCwd: "ask" };
  assert.equal(decide(config, file("write", "/etc/hosts", "/etc/hosts"), CWD).outcome, "ask");
  assert.equal(
    decide(config, file("write", "/etc/hosts", "/etc/hosts"), CWD).dimension,
    "outsideCwd",
  );
});

test("outsideCwd: ignores a read outside cwd under the default appliesTo", () => {
  const config: Config = { ...base, outsideCwd: "deny" };
  assert.equal(decide(config, file("read", "/etc/hosts", "/etc/hosts"), CWD).outcome, "allow");
  assert.equal(decide(config, file("grep", "/etc", "/etc"), CWD).outcome, "allow");
});

test("outsideCwd: gates reads once appliesTo includes them", () => {
  const config: Config = { ...base, outsideCwd: "ask", paths: { appliesTo: ["read", "write"] } };
  assert.equal(decide(config, file("read", "/etc/hosts", "/etc/hosts"), CWD).outcome, "ask");
});

test("outsideCwd: contributes nothing when set to allow", () => {
  const config: Config = { ...base, defaultMode: "deny", outsideCwd: "allow" };
  const decision = decide(config, file("write", "/etc/hosts", "/etc/hosts"), CWD);
  assert.equal(decision.outcome, "deny");
  assert.equal(decision.dimension, undefined);
});

test("outsideCwd: does not fire for paths inside the working directory", () => {
  const config: Config = { ...base, outsideCwd: "deny" };
  assert.equal(decide(config, file("write", "src/a.ts", "/repo/src/a.ts"), CWD).outcome, "allow");
});

test("outsideCwd: never fires for bash, which carries no paths", () => {
  const config: Config = { ...base, outsideCwd: "deny" };
  assert.equal(decide(config, bash("cat /etc/hosts"), CWD).outcome, "allow");
});

// --- cross-dimension most-restrictive-wins -------------------------------

test("an allowed tool still asks when its write leaves the working directory", () => {
  const config: Config = { ...base, outsideCwd: "ask", tools: { allow: ["write"] } };
  assert.equal(decide(config, file("write", "/etc/hosts", "/etc/hosts"), CWD).outcome, "ask");
});

test("a path deny outranks a tool allow", () => {
  const config: Config = {
    ...base,
    tools: { allow: ["write"] },
    paths: { appliesTo: ["write"], deny: [".env"] },
  };
  assert.equal(decide(config, file("write", ".env", "/repo/.env"), CWD).outcome, "deny");
});

test("allow when every match agrees on allow", () => {
  const config: Config = {
    ...base,
    tools: { allow: ["write"] },
    paths: { appliesTo: ["write"], allow: ["*.txt"] },
  };
  assert.equal(decide(config, file("write", "a.txt", "/repo/a.txt"), CWD).outcome, "allow");
});

// --- default config sanity -----------------------------------------------

test("default config: allows .env.example while denying .env", () => {
  assert.equal(decide(DEFAULT_CONFIG, file("write", ".env", "/repo/.env"), CWD).outcome, "deny");
  assert.equal(
    decide(DEFAULT_CONFIG, file("write", ".env.example", "/repo/.env.example"), CWD).outcome,
    "allow",
  );
});

test("default config: read of /etc/hosts is allowed, write is asked", () => {
  assert.equal(
    decide(DEFAULT_CONFIG, file("read", "/etc/hosts", "/etc/hosts"), CWD).outcome,
    "allow",
  );
  assert.equal(
    decide(DEFAULT_CONFIG, file("write", "/etc/hosts", "/etc/hosts"), CWD).outcome,
    "ask",
  );
});
