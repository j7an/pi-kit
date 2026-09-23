import { homedir } from "node:os";
import { isAbsolute, normalize, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { globToRegExp } from "./glob.ts";

const UNICODE_SPACES = /[\u00A0\u2000-\u200A\u202F\u205F\u3000]/g;

/** Expands a leading `~` to the user's home directory. */
export function expandHome(p: string): string {
  if (p === "~") return homedir();
  if (p.startsWith("~/")) return resolve(homedir(), p.slice(2));
  return p;
}

function normalizeLikePi(raw: string): string {
  let p = raw.replace(UNICODE_SPACES, " ");
  if (p.startsWith("@")) p = p.slice(1);
  p = expandHome(p);
  if (/^file:\/\//.test(p)) p = fileURLToPath(p);
  return p;
}

/** Resolves a tool-supplied path to an absolute, normalised path. */
export function resolvePath(raw: string, cwd: string): string {
  const expanded = normalizeLikePi(raw);
  return isAbsolute(expanded) ? normalize(expanded) : resolve(cwd, expanded);
}

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
