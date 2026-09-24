import { globToRegExp } from "./glob.ts";

/**
 * Splits a shell command into segments on unquoted `&&`, `||`, `;`, `|`,
 * `|&`, and newline.
 *
 * This is a scanner, not a parser. It understands single quotes, double
 * quotes, backslash escapes, and line comments: parentheses, `$(...)`,
 * backticks, braces, and heredocs are not tracked, so an operator inside one
 * of them splits too. An unterminated quote swallows the rest of the string.
 * The decision engine must use segment candidates restrictively.
 *
 * Segments are trimmed; empty segments are dropped.
 */
export function splitCommand(command: string): string[] {
  const segments: string[] = [];
  let current = "";
  let quote: "'" | '"' | undefined;
  let wordStart = true;

  const flush = (): void => {
    const trimmed = current.trim();
    if (trimmed !== "") segments.push(trimmed);
    current = "";
    wordStart = true;
  };

  let i = 0;
  while (i < command.length) {
    const ch = command[i] as string;
    const next = command[i + 1];

    if (quote !== undefined) {
      if (quote === '"' && ch === "\\" && next !== undefined) {
        current += ch + next;
        i += 2;
        continue;
      }
      if (ch === quote) quote = undefined;
      current += ch;
      i += 1;
      continue;
    }

    if (ch === "\\" && next !== undefined) {
      current += ch + next;
      if (next !== "\n") wordStart = false;
      i += 2;
      continue;
    }
    if (ch === "'" || ch === '"') {
      quote = ch;
      wordStart = false;
      current += ch;
      i += 1;
      continue;
    }
    if (ch === "#" && wordStart) {
      const end = command.indexOf("\n", i);
      const stop = end === -1 ? command.length : end;
      current += command.slice(i, stop);
      i = stop;
      continue;
    }
    if (ch === "\n" || ch === ";") {
      flush();
      i += 1;
      continue;
    }
    if (ch === "&" && next === "&") {
      flush();
      i += 2;
      continue;
    }
    if (ch === "|") {
      flush();
      i += next === "|" || next === "&" ? 2 : 1;
      continue;
    }
    current += ch;
    wordStart = /[ \t;&|()<>]/.test(ch);
    i += 1;
  }
  flush();
  return segments;
}

/**
 * Everything a `bash` pattern is matched against: the whole trimmed command
 * first, then each segment. Deduplicated, so a single-segment command yields
 * one candidate.
 */
export function commandCandidates(command: string): string[] {
  const candidates = new Set<string>();
  const whole = command.trim();
  if (whole !== "") candidates.add(whole);
  for (const segment of splitCommand(command)) candidates.add(segment);
  return [...candidates];
}

/**
 * Matches a command pattern against a shell command.
 *
 * Patterns are anchored: `git status` matches only that exact string, while
 * `git status*` also matches `git status --short`. `*` spans whitespace and
 * `/`. Returns the first candidate that matched (the whole command when it
 * matches, otherwise the segment), which the block reason quotes.
 *
 * `candidates: "whole"` tries only the whole trimmed command. The decision
 * engine uses it for allow rules so segment candidates are used restrictively.
 *
 * Deliberately string-level. It does not resist `bash -c`, `eval`, `$(...)`,
 * `/bin/rm`, or `$VAR`.
 */
export function matchCommand(
  pattern: string,
  command: string,
  candidates: "all" | "whole" = "all",
): string | undefined {
  const re = globToRegExp(pattern, { crossSegment: true });
  const subjects = candidates === "whole" ? [command.trim()] : commandCandidates(command);
  return subjects.find((candidate) => candidate !== "" && re.test(candidate));
}
