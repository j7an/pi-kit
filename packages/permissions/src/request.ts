import type { PermissionRequest } from "./decide.ts";
import { resolvePath } from "./match/path.ts";

/** Pi built-in tools carrying a `path` input. */
const PATH_TOOLS = new Set(["read", "write", "edit", "ls", "grep", "find"]);

/** Normalises a Pi tool call into a Pi-agnostic PermissionRequest. */
export function toRequest(
  toolName: string,
  input: Record<string, unknown>,
  cwd: string,
): PermissionRequest {
  if (toolName === "bash" || toolName === "powershell") {
    const command = typeof input.command === "string" ? input.command : "";
    return { tool: toolName, command, paths: [], rawPaths: [] };
  }

  if (PATH_TOOLS.has(toolName)) {
    const raw = typeof input.path === "string" ? input.path : ".";
    return { tool: toolName, paths: [resolvePath(raw, cwd)], rawPaths: [raw] };
  }

  return { tool: toolName, paths: [], rawPaths: [] };
}
