import { isAbsolute, resolve, sep } from "node:path";
import { expandHome } from "@pi-kit/shared/path";
import { globToRegExp } from "./glob.ts";

/** Matches a path pattern against a tool-supplied path and its resolved target. */
export function matchPath(pattern: string, raw: string, resolved: string, cwd: string): boolean {
  const expanded = expandHome(pattern);
  const patterns = isAbsolute(expanded) ? [expanded] : [expanded, resolve(cwd, expanded)];
  const subjects = [raw, resolved];
  return patterns.some((p) => {
    const re = globToRegExp(p, { crossSegment: false });
    return subjects.some((s) => re.test(s));
  });
}

/** True when the resolved path lies outside the working directory. */
export function isOutsideCwd(resolved: string, cwd: string): boolean {
  const base = resolve(cwd);
  if (resolved === base) return false;
  return !resolved.startsWith(base.endsWith(sep) ? base : base + sep);
}
