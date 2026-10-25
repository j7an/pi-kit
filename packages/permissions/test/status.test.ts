import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_CONFIG } from "../src/config/defaults.ts";
import { type LoadResult, mergeConfig } from "../src/config/load.ts";
import { formatStatus } from "../src/status.ts";

const HEADER = "pi-kit permissions (loaded at session start; edits take effect in a new session)";

const result = (over: Partial<LoadResult> = {}): LoadResult => ({
  config: mergeConfig({}, DEFAULT_CONFIG),
  problems: [],
  forcedAsk: false,
  layers: [
    { name: "Built-in defaults", status: "loaded", config: DEFAULT_CONFIG },
    { name: "Global", path: "/g.json", status: "not found" },
    { name: "Project", path: "/p.json", status: "not found" },
  ],
  ...over,
});

const lines = (text: string) => text.split("\n");

test("formatStatus: starts with the header and the effective settings", () => {
  const [first, second] = lines(formatStatus(result(), []));
  assert.equal(first, HEADER);
  assert.equal(
    second,
    "defaultMode allow · headlessAsk deny · outsideCwd ask · path rules apply to: write, edit",
  );
});

test("formatStatus: marks a forced ask", () => {
  const forced = result({
    forcedAsk: true,
    config: { ...mergeConfig({}, DEFAULT_CONFIG), defaultMode: "ask" },
  });
  const second = lines(formatStatus(forced, []))[1] ?? "";
  assert.match(second, /defaultMode ask/);
  assert.ok(second.endsWith(" (forced: config invalid)"));
});

test("formatStatus: lists every default pattern in full", () => {
  const text = formatStatus(result(), []);
  assert.match(text, /bash deny\s+rm -rf \*, git push --force\*, git reset --hard\*/);
  assert.match(text, /paths ask\s+\.github\/\*\*, .*~\/\.npmrc/);
});

test("formatStatus: names each file layer with its path and status", () => {
  const [defaults, global] = result().layers;
  const text = formatStatus(
    result({
      layers: [
        defaults as LoadResult["layers"][number],
        global as LoadResult["layers"][number],
        { name: "Project", path: "/p.json", status: "untrusted (not read)" },
      ],
    }),
    [],
  );
  assert.match(text, /^Global {2}\/g\.json — not found\nProject/m);
  assert.match(text, /^Project {2}\/p\.json — untrusted \(not read\)$/m);
});

test("formatStatus: shows a loaded layer's own values as written", () => {
  const [defaults, global] = result().layers;
  const text = formatStatus(
    result({
      config: { ...mergeConfig({}, DEFAULT_CONFIG), defaultMode: "ask" },
      layers: [
        defaults as LoadResult["layers"][number],
        global as LoadResult["layers"][number],
        {
          name: "Project",
          path: "/p.json",
          status: "loaded",
          config: { defaultMode: "allow", bash: { ask: ["curl *"] } },
        },
      ],
    }),
    [],
  );
  const project = text.slice(text.indexOf("Project  /p.json"));
  assert.match(project, /^ {2}defaultMode\s+allow$/m);
  assert.match(project, /bash ask\s+curl \*/);
  assert.match(lines(text)[1] ?? "", /^defaultMode ask /);
});

test("formatStatus: omits empty lists", () => {
  const [defaults, , project] = result().layers;
  const text = formatStatus(
    result({
      layers: [
        defaults as LoadResult["layers"][number],
        { name: "Global", path: "/g.json", status: "loaded", config: { bash: { ask: [] } } },
        project as LoadResult["layers"][number],
      ],
    }),
    [],
  );
  assert.match(text, /^Global {2}\/g\.json — loaded\nProject/m);
});

test("formatStatus: lists approvals and problems, or none", () => {
  assert.match(
    formatStatus(result(), []),
    /Allowed for this session\n {2}none\nProblems\n {2}none$/,
  );
  assert.match(
    formatStatus(result({ problems: ["x: bad"] }), ["bash: npm test"]),
    /Allowed for this session\n {2}bash: npm test\nProblems\n {2}x: bad$/,
  );
});

test("formatStatus: an empty appliesTo reads as none", () => {
  const [defaults, , project] = result().layers;
  const empty = { paths: { appliesTo: [] } };
  const text = formatStatus(
    result({
      config: mergeConfig(mergeConfig({}, DEFAULT_CONFIG), empty),
      layers: [
        defaults as LoadResult["layers"][number],
        { name: "Global", path: "/g.json", status: "loaded", config: empty },
        project as LoadResult["layers"][number],
      ],
    }),
    [],
  );
  assert.ok((lines(text)[1] ?? "").endsWith("path rules apply to: none"));
  assert.match(text, /^Global {2}\/g\.json — loaded\n {2}paths appliesTo\s+none$/m);
});

test("formatStatus: indents the continuation lines of a multi-line entry", () => {
  const text = formatStatus(result({ problems: ["a\nb"] }), ["bash: echo a\necho b"]);
  assert.match(text, /\n {2}bash: echo a\n {4}echo b\nProblems\n {2}a\n {4}b$/);
});
