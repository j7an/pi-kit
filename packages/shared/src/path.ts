import { homedir } from "node:os";
import { isAbsolute, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";

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
