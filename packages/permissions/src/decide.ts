import { DEFAULT_CONFIG } from "./config/defaults.ts";
import type { Config, Mode, RuleSet } from "./config/schema.ts";
import { matchCommand } from "./match/command.ts";
import { isOutsideCwd, matchPath } from "./match/path.ts";

type Dimension = "tools" | "bash" | "paths" | "outsideCwd";

/** A normalised, Pi-agnostic description of one tool call. */
export type PermissionRequest = {
  tool: string;
  /** Present only for the shell tools, `bash` and `powershell`. */
  command?: string;
  /** Absolute, resolved paths. Empty for path-less calls. */
  paths: string[];
  /** The same paths as the agent referenced them, index-aligned with `paths`. */
  rawPaths: string[];
};

export type Decision = {
  outcome: Mode;
  dimension?: Dimension;
  /** The pattern that produced this outcome, for the block message. */
  pattern?: string;
  /** The command segment that matched, when it differs from the whole command. */
  segment?: string;
};

const RANK: Record<Mode, number> = { allow: 0, ask: 1, deny: 2 };
const ORDER = ["deny", "ask", "allow"] as const;

type Match = { outcome: Mode; dimension: Dimension; pattern: string; segment?: string };

/**
 * Checks a rule set in deny → ask → allow order; the first match wins.
 * `matches` receives the pattern and the list it came from and returns the
 * matched subject (a command candidate) or a boolean.
 */
function matchRuleSet(
  set: RuleSet | undefined,
  dimension: Dimension,
  matches: (pattern: string, mode: Mode) => string | boolean | undefined,
): Match | undefined {
  if (!set) return undefined;
  for (const mode of ORDER) {
    for (const pattern of set[mode] ?? []) {
      const hit = matches(pattern, mode);
      if (hit === false || hit === undefined) continue;
      return typeof hit === "string"
        ? { outcome: mode, dimension, pattern, segment: hit }
        : { outcome: mode, dimension, pattern };
    }
  }
  return undefined;
}

/**
 * Resolves a tool call to allow / ask / deny.
 *
 * Two rules, and this is the whole specification:
 *
 *   1. Within a dimension, lists are checked deny → ask → allow; first match
 *      wins and later lists are not consulted. Specificity is ignored.
 *   2. Across dimensions, every applicable dimension is evaluated and the most
 *      restrictive match wins (deny > ask > allow).
 *
 * If no whole-request dimension matches, the outcome starts at `defaultMode`.
 * Bash deny and ask patterns also check command segments, which may only make
 * that outcome more restrictive. Bash allow patterns check the whole command.
 *
 * Pure: no session state, no I/O. Session approvals are consulted by the
 * caller only after this returns `ask`, which is what makes "an approval can
 * never override a deny" true by construction.
 */
export function decide(config: Config, req: PermissionRequest, cwd: string): Decision {
  const matches: Match[] = [];
  let segmentMatch: Match | undefined;

  const toolMatch = matchRuleSet(
    config.tools,
    "tools",
    (pattern) => pattern === "*" || pattern === req.tool,
  );
  if (toolMatch) matches.push(toolMatch);

  const command = req.command;
  if (command !== undefined) {
    const whole = command.trim();
    const bashMatch = matchRuleSet(config.bash, "bash", (pattern) =>
      matchCommand(pattern, command, "whole"),
    );
    if (bashMatch) matches.push({ ...bashMatch, segment: undefined });

    segmentMatch = matchRuleSet(config.bash, "bash", (pattern, mode) => {
      if (mode === "allow") return undefined;
      const hit = matchCommand(pattern, command);
      return hit === whole ? undefined : hit;
    });
  }

  const appliesTo = config.paths?.appliesTo ?? DEFAULT_CONFIG.paths.appliesTo;
  if (appliesTo.includes(req.tool)) {
    for (const [index, resolved] of req.paths.entries()) {
      const raw = req.rawPaths[index] ?? resolved;
      const pathMatch = matchRuleSet(config.paths, "paths", (pattern) =>
        matchPath(pattern, raw, resolved, cwd),
      );
      if (pathMatch) matches.push(pathMatch);
    }

    // `allow` disables the check entirely rather than acting as a match that
    // could override a restrictive defaultMode. Gated by appliesTo: reads are
    // ungated by default, as in both reference CLIs.
    const outsideCwd = config.outsideCwd ?? DEFAULT_CONFIG.outsideCwd;
    if (outsideCwd !== "allow" && req.paths.some((p) => isOutsideCwd(p, cwd))) {
      matches.push({ outcome: outsideCwd, dimension: "outsideCwd", pattern: "outsideCwd" });
    }
  }

  const first = matches[0];
  const wholeWinner =
    first === undefined
      ? undefined
      : matches.reduce((acc, next) => (RANK[next.outcome] > RANK[acc.outcome] ? next : acc), first);
  const baseline = wholeWinner?.outcome ?? config.defaultMode ?? DEFAULT_CONFIG.defaultMode;
  const worst =
    segmentMatch && RANK[segmentMatch.outcome] > RANK[baseline] ? segmentMatch : wholeWinner;
  if (worst === undefined) return { outcome: baseline };
  const decision: Decision = {
    outcome: worst.outcome,
    dimension: worst.dimension,
    pattern: worst.pattern,
  };
  if (worst.segment !== undefined) decision.segment = worst.segment;
  return decision;
}
