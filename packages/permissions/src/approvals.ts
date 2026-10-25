import type { PermissionRequest } from "./decide.ts";

/**
 * Session approvals: exact requests, or a command prefix for the shell tools.
 * The caller consults them only after `decide()` returns `ask`, so an approval
 * can never override a deny.
 */

/** The session-entry `customType` approvals are saved under. */
export const APPROVAL_ENTRY = "pi-kit-permissions-approval";

export type Approval = {
  kind: "exact" | "prefix";
  tool: string;
  /** `requestKey(req)` for `exact`; the command prefix for `prefix`. */
  value: string;
  /** Shown by `/permissions`. */
  description: string;
  cwd: string;
};

/**
 * Characters that would let a prefix approval carry a second command, a
 * redirect or a substitution. `\r` is a line break to PowerShell.
 */
const UNSAFE = /[;&|<>$`(){}\\\n\r]/;
const COMMAND_NAME = /^\w[\w.+-]*$/;
const SUBCOMMAND = /^[A-Za-z][A-Za-z0-9-]*$/;

/** Splits on the shell's blanks only; `trim()` would also strip NBSP and BOM, which bash keeps. */
function words(command: string): string[] {
  return command.replace(/^[ \t]+|[ \t]+$/g, "").split(/[ \t]+/);
}

export function requestKey(req: PermissionRequest): string {
  return `${req.tool}\0${req.command ?? ""}\0${req.rawPaths.join("\0")}`;
}

/** The prefix to offer for a shell command, if a prefix approval could ever cover it. */
export function commandPrefix(command: string): string | undefined {
  if (UNSAFE.test(command)) return undefined;
  const [name, second, ...rest] = words(command);
  if (name === undefined || !COMMAND_NAME.test(name)) return undefined;
  if (second === undefined) return undefined;
  if (!SUBCOMMAND.test(second)) return name;
  return rest.length > 0 ? `${name} ${second}` : undefined;
}

function coversCommand(prefix: string, command: string): boolean {
  if (UNSAFE.test(command)) return false;
  const have = words(command);
  return words(prefix).every((word, index) => have[index] === word);
}

export function isApproved(approvals: readonly Approval[], req: PermissionRequest): boolean {
  return approvals.some((approval) => {
    if (approval.tool !== req.tool) return false;
    if (approval.kind === "exact") return approval.value === requestKey(req);
    return req.command !== undefined && coversCommand(approval.value, req.command);
  });
}

function isApproval(data: unknown): data is Approval {
  if (typeof data !== "object" || data === null) return false;
  const record = data as Record<string, unknown>;
  return (
    (record.kind === "exact" || record.kind === "prefix") &&
    ["tool", "value", "description", "cwd"].every((key) => typeof record[key] === "string")
  );
}

/** Approvals saved in this session's entries for `cwd`; malformed entries grant nothing. */
export function restoreApprovals(entries: readonly unknown[], cwd: string): Approval[] {
  const approvals: Approval[] = [];
  for (const entry of entries) {
    if (typeof entry !== "object" || entry === null) continue;
    const { type, customType, data } = entry as Record<string, unknown>;
    if (type !== "custom" || customType !== APPROVAL_ENTRY) continue;
    if (isApproval(data) && data.cwd === cwd) approvals.push(data);
  }
  return approvals;
}
