import type { Decision, PermissionRequest } from "./decide.ts";

const PREFIX = "Blocked by pi-kit permissions";

export const ALLOW_ONCE = "Allow once";
export const ALLOW_SESSION = "Allow for this session";
export const DENY = "Deny";

type PromptAnswer = "once" | "session" | "deny";

/** The slice of Pi's `ctx.ui` this module needs. Keeps tests free of Pi. */
type PromptUI = {
  select(message: string, options: string[]): Promise<string | undefined>;
};

/** A one-line, human-readable summary of what the agent tried to do. */
export function describeRequest(req: PermissionRequest): string {
  if (req.command !== undefined && req.command !== "") return `${req.tool}: ${req.command}`;
  const first = req.rawPaths[0];
  if (first !== undefined) return `${req.tool}: ${first}`;
  return req.tool;
}

function ruleClause(decision: Decision, req: PermissionRequest): string {
  const base = `${decision.dimension} rule "${decision.pattern}" (${decision.outcome})`;
  if (decision.segment === undefined) return base;
  return `${base} matched segment "${decision.segment}" of "${req.command ?? ""}"`;
}

export function blockReason(
  decision: Decision,
  req: PermissionRequest,
  opts: { headless: boolean; forcedAskProblem?: string },
): string {
  const suffix = opts.headless ? " No UI is available to prompt." : "";

  if (decision.dimension === "outsideCwd") {
    const path = req.rawPaths[0] ?? "(unknown path)";
    return `${PREFIX}: "${path}" is outside the working directory (outsideCwd: ${decision.outcome}).${suffix}`;
  }

  if (decision.dimension !== undefined && decision.pattern !== undefined) {
    return `${PREFIX}: ${ruleClause(decision, req)}. Attempted ${describeRequest(req)}.${suffix}`;
  }

  if (opts.forcedAskProblem !== undefined) {
    return `${PREFIX}: config invalid (defaultMode forced to ask): ${opts.forcedAskProblem}. Attempted ${describeRequest(req)}.${suffix}`;
  }

  return `${PREFIX}: defaultMode is "${decision.outcome}" and no rule allowed ${describeRequest(req)}.${suffix}`;
}

export function gateErrorReason(error: unknown): string {
  return `${PREFIX}: internal error (gate_error): ${String(error)}.`;
}

export async function promptUser(
  ui: PromptUI,
  req: PermissionRequest,
  decision: Decision,
): Promise<PromptAnswer> {
  const rule =
    decision.dimension !== undefined && decision.pattern !== undefined
      ? `\n\nMatched ${ruleClause(decision, req)}.`
      : "";
  const message = `pi-kit permissions\n\n  ${describeRequest(req)}${rule}`;

  const choice = await ui.select(message, [ALLOW_ONCE, ALLOW_SESSION, DENY]);
  if (choice === ALLOW_ONCE) return "once";
  if (choice === ALLOW_SESSION) return "session";
  return "deny";
}
