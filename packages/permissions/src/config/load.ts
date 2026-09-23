import { join } from "node:path";
import { DEFAULT_CONFIG } from "./defaults.ts";
import { type Config, type PathRuleSet, type RuleSet, validateConfig } from "./schema.ts";

const CONFIG_FILE = "pi-kit-permissions.json";

/** `agentDir` is Pi's `getAgentDir()`; never hardcode `~/.pi/agent`. */
export function globalConfigPath(agentDir: string): string {
  return join(agentDir, "extensions", CONFIG_FILE);
}

/** `configDirName` is Pi's `CONFIG_DIR_NAME`; never hardcode `.pi`. */
export function projectConfigPath(cwd: string, configDirName: string): string {
  return join(cwd, configDirName, CONFIG_FILE);
}

export type LoadResult = {
  config: Config;
  /** Human-readable problems to surface at startup. Empty when all is well. */
  problems: string[];
  /** True when any scope was malformed; asks then require an interactive UI. */
  forcedAsk: boolean;
};

type LoadOptions = {
  cwd: string;
  agentDir: string;
  configDirName: string;
  trusted: boolean;
  /** Whether a file exists. Kept separate so untrusted files are never read. */
  exists: (path: string) => boolean;
  /** Returns file contents, or undefined when the file does not exist. */
  readFile: (path: string) => string | undefined;
};

type ScopeOutcome = { kind: "absent" } | { kind: "valid"; config: Config } | { kind: "malformed" };

function readScope(
  path: string,
  readFile: LoadOptions["readFile"],
  problems: string[],
): ScopeOutcome {
  let raw: string | undefined;
  try {
    raw = readFile(path);
  } catch (error) {
    problems.push(`${path}: could not be read (${String(error)})`);
    return { kind: "malformed" };
  }
  if (raw === undefined) return { kind: "absent" };

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    problems.push(`${path}: invalid JSON (${String(error)})`);
    return { kind: "malformed" };
  }

  const result = validateConfig(parsed);
  if (!result.ok) {
    problems.push(`${path}: ${result.errors.join("; ")}`);
    return { kind: "malformed" };
  }
  return { kind: "valid", config: result.config };
}

function unionList(base: string[] | undefined, patch: string[] | undefined): string[] | undefined {
  if (base === undefined && patch === undefined) return undefined;
  return [...new Set([...(base ?? []), ...(patch ?? [])])];
}

function mergeRuleSet(base: RuleSet | undefined, patch: RuleSet | undefined): RuleSet | undefined {
  if (patch === undefined) return base;
  if (base === undefined) return patch;
  const out: RuleSet = {};
  for (const key of ["deny", "ask", "allow"] as const) {
    const merged = unionList(base[key], patch[key]);
    if (merged !== undefined) out[key] = merged;
  }
  return out;
}

function mergePathRuleSet(
  base: PathRuleSet | undefined,
  patch: PathRuleSet | undefined,
): PathRuleSet | undefined {
  if (patch === undefined) return base;
  if (base === undefined) return patch;
  const out: PathRuleSet = { ...mergeRuleSet(base, patch) };
  // `appliesTo` selects WHICH tools are gated, not what is denied, so a scope
  // must be able to narrow it. It overwrites; it does not union.
  const appliesTo = patch.appliesTo ?? base.appliesTo;
  if (appliesTo !== undefined) out.appliesTo = appliesTo;
  return out;
}

/**
 * Merges one scope onto another.
 *
 * Rule lists union (deduplicated), so a patch can add rules but never remove
 * an inherited one. Scalars and `appliesTo` overwrite. Keys the patch omits
 * are inherited untouched.
 */
export function mergeConfig(base: Config, patch: Config): Config {
  const out: Config = { ...base };
  if (patch.defaultMode !== undefined) out.defaultMode = patch.defaultMode;
  if (patch.headlessAsk !== undefined) out.headlessAsk = patch.headlessAsk;
  if (patch.outsideCwd !== undefined) out.outsideCwd = patch.outsideCwd;
  const tools = mergeRuleSet(base.tools, patch.tools);
  if (tools !== undefined) out.tools = tools;
  const bash = mergeRuleSet(base.bash, patch.bash);
  if (bash !== undefined) out.bash = bash;
  const paths = mergePathRuleSet(base.paths, patch.paths);
  if (paths !== undefined) out.paths = paths;
  return out;
}

/**
 * Loads configuration: DEFAULT_CONFIG ← global ← trusted project.
 *
 * Each scope validates independently; a malformed scope contributes no rules
 * and never discards a sibling. Any malformed scope forces `defaultMode` to
 * "ask" and `headlessAsk` to "deny" for the session, so a broken config fails
 * closed instead of silently loosening to the permissive defaults. Project config is read only when the
 * project is trusted, and an untrusted file is never opened.
 */
export function loadConfig(opts: LoadOptions): LoadResult {
  const problems: string[] = [];
  let forcedAsk = false;
  let config: Config = mergeConfig({}, DEFAULT_CONFIG);

  const apply = (outcome: ScopeOutcome): void => {
    if (outcome.kind === "valid") config = mergeConfig(config, outcome.config);
    if (outcome.kind === "malformed") forcedAsk = true;
  };

  apply(readScope(globalConfigPath(opts.agentDir), opts.readFile, problems));

  const projectPath = projectConfigPath(opts.cwd, opts.configDirName);
  if (opts.trusted) {
    apply(readScope(projectPath, opts.readFile, problems));
  } else if (opts.exists(projectPath)) {
    // Deliberately does not read the file. An untrusted repository's config is
    // attacker-authored content; knowing it is there is enough to report the
    // skip.
    problems.push(`${projectPath}: ignored because the project is untrusted`);
  }

  if (forcedAsk) {
    config = { ...config, defaultMode: "ask", headlessAsk: "deny" };
    problems.push(
      'defaultMode forced to "ask" and headlessAsk forced to "deny" until the config above is fixed',
    );
  }

  return { config, problems, forcedAsk };
}
