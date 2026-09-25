/**
 * Compiles a glob pattern into an anchored RegExp.
 *
 * crossSegment: true  — `*` spans any characters, including `/` and whitespace.
 *                       Used for shell command patterns.
 * crossSegment: false — `*` stays within a path segment; `**` crosses segments.
 *                       Used for filesystem path patterns.
 */
export function globToRegExp(pattern: string, opts: { crossSegment: boolean }): RegExp {
  let out = "";
  let i = 0;
  while (i < pattern.length) {
    const ch = pattern[i] as string;
    if (ch === "*") {
      if (!opts.crossSegment && pattern[i + 1] === "*") {
        if (pattern[i + 2] === "/") {
          // `**/` is zero or more WHOLE directory segments, so `**/.env`
          // matches `.env` and `a/b/.env` but not `foo.env`. Compiling it as
          // `.*` would drop the slash and deny unrelated basenames.
          out += "(?:[^/]*/)*";
          i += 3;
        } else {
          out += ".*";
          i += 2;
        }
        continue;
      }
      out += opts.crossSegment ? ".*" : "[^/]*";
      i += 1;
      continue;
    }
    out += ch.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    i += 1;
  }
  // `s` (dotAll): `.*` must span a newline, because a quoted newline stays
  // inside one command segment and the spec says `*` spans all whitespace.
  return new RegExp(`^${out}$`, "s");
}
