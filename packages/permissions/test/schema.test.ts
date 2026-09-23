import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_CONFIG } from "../src/config/defaults.ts";
import { validateConfig } from "../src/config/schema.ts";

test("validateConfig: accepts an empty object", () => {
  assert.equal(validateConfig({}).ok, true);
});

test("validateConfig: accepts the documented example config", () => {
  const result = validateConfig({
    defaultMode: "allow",
    headlessAsk: "deny",
    outsideCwd: "ask",
    tools: { deny: [], ask: [], allow: [] },
    bash: { deny: ["rm -rf *"], ask: ["npm publish*"], allow: [] },
    paths: { appliesTo: ["write", "edit"], deny: [".env"], ask: [], allow: [] },
  });
  assert.equal(result.ok, true);
});

test("validateConfig: rejects an unknown mode and names the offending path", () => {
  const result = validateConfig({ defaultMode: "sometimes" });
  assert.equal(result.ok, false);
  if (result.ok) throw new Error("expected failure");
  assert.match(result.errors.join("\n"), /\/defaultMode/);
});

test("validateConfig: rejects a string where a list is required", () => {
  const result = validateConfig({ bash: { deny: "rm -rf *" } });
  assert.equal(result.ok, false);
  if (result.ok) throw new Error("expected failure");
  assert.match(result.errors.join("\n"), /\/bash\/deny/);
});

test("validateConfig: rejects unknown top-level keys", () => {
  assert.equal(validateConfig({ permissions: {} }).ok, false);
});

test("validateConfig: rejects appliesTo outside the paths dimension", () => {
  assert.equal(validateConfig({ bash: { appliesTo: ["write"] } }).ok, false);
  assert.equal(validateConfig({ tools: { appliesTo: ["write"] } }).ok, false);
  assert.equal(validateConfig({ paths: { appliesTo: ["write"] } }).ok, true);
});

test("validateConfig: rejects headlessAsk: ask, which has no coherent meaning", () => {
  assert.equal(validateConfig({ headlessAsk: "ask" }).ok, false);
  assert.equal(validateConfig({ headlessAsk: "allow" }).ok, true);
  assert.equal(validateConfig({ headlessAsk: "deny" }).ok, true);
});

test("validateConfig: one error per offending location, not one per union member", () => {
  const result = validateConfig({ defaultMode: "sometimes" });
  if (result.ok) throw new Error("expected failure");
  assert.equal(result.errors.length, 1);
});

test("DEFAULT_CONFIG: is itself valid", () => {
  assert.equal(validateConfig(DEFAULT_CONFIG).ok, true);
});

test("DEFAULT_CONFIG: matches the spec's normative JSON projection", () => {
  // Spec §5 "Shape" is normative. This is its parsed value; the README must
  // carry the same block. Keep all three in step.
  assert.deepEqual(JSON.parse(JSON.stringify(DEFAULT_CONFIG)), {
    defaultMode: "allow",
    headlessAsk: "deny",
    outsideCwd: "ask",
    tools: {},
    bash: {
      deny: ["rm -rf *", "git push --force*", "git reset --hard*"],
      ask: ["npm publish*", "git push*"],
      allow: [],
    },
    paths: {
      appliesTo: ["write", "edit"],
      deny: [".env", ".env.local", ".env.*.local", "**/.env", "**/.env.local"],
      ask: [".github/**"],
      allow: [],
    },
  });
});
