import { globToRegExp } from "./glob.ts";

/**
 * Splits a shell command into segments on unquoted `&&`, `||`, `;`, `|`,
 * `|&`, `&`, and newline. Unquoted runs of spaces and tabs collapse to one space.
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
  let blank = false;

  const flush = (): void => {
    const trimmed = current.trim();
    if (trimmed !== "") segments.push(trimmed);
    current = "";
    wordStart = true;
    blank = false;
  };

  let i = 0;
  while (i < command.length) {
    const ch = command[i] as string;
    const next = command[i + 1];

    if (quote !== undefined) {
      if (quote === '"' && ch === "\\" && next !== undefined) {
        current += ch + next;
        blank = false;
        i += 2;
        continue;
      }
      if (ch === quote) quote = undefined;
      current += ch;
      blank = false;
      i += 1;
      continue;
    }

    if (ch === "\\" && next !== undefined) {
      current += ch + next;
      blank = false;
      if (next !== "\n") wordStart = false;
      i += 2;
      continue;
    }
    if (ch === "'" || ch === '"') {
      quote = ch;
      wordStart = false;
      current += ch;
      blank = false;
      i += 1;
      continue;
    }
    if (ch === "#" && wordStart) {
      const end = command.indexOf("\n", i);
      const stop = end === -1 ? command.length : end;
      current += command.slice(i, stop);
      blank = false;
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
    if (
      ch === "&" &&
      next !== "&" &&
      next !== ">" &&
      command[i - 1] !== ">" &&
      command[i - 1] !== "<"
    ) {
      flush();
      i += 1;
      continue;
    }
    if (ch === " " || ch === "\t") {
      if (!blank) current += " ";
      blank = true;
    } else {
      current += ch;
      blank = false;
    }
    wordStart = /[ \t;&|()<>]/.test(ch);
    i += 1;
  }
  flush();
  return segments;
}

type Word = { start: number; value: string; op: boolean };

function shellWords(segment: string): Word[] {
  const words: Word[] = [];
  let start: number | undefined;
  let value = "";
  let quote: "'" | '"' | undefined;

  const flush = (): void => {
    if (start !== undefined) words.push({ start, value, op: false });
    start = undefined;
    value = "";
  };

  let i = 0;
  while (i < segment.length) {
    const ch = segment[i] as string;
    const next = segment[i + 1];
    if (quote !== undefined) {
      if (quote === '"' && ch === "\\" && next !== undefined) {
        value += next;
        i += 2;
        continue;
      }
      if (ch === quote) quote = undefined;
      else value += ch;
      i += 1;
      continue;
    }
    if (ch === "#" && start === undefined) break;
    if (ch === " " || ch === "\t") {
      flush();
      i += 1;
      continue;
    }
    if (ch === "<" || ch === ">" || ch === "&") {
      flush();
      const opStart = i;
      while (i < segment.length && /[<>&]/.test(segment[i] as string)) i += 1;
      words.push({ start: opStart, value: segment.slice(opStart, i), op: true });
      continue;
    }
    start ??= i;
    if (ch === "\\" && next !== undefined) {
      value += next;
      i += 2;
      continue;
    }
    if (ch === "'" || ch === '"') quote = ch;
    else value += ch;
    i += 1;
  }
  flush();
  return words;
}

// Deny/ask only: generic skipping can over-strip, which only adds a candidate. Allow needs exact per-wrapper parsing.
const WRAPPERS = new Set([
  "timeout",
  "time",
  "nice",
  "nohup",
  "stdbuf",
  "command",
  "builtin",
  "noglob",
  "env",
]);
const ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/;
const WRAPPER_ARG = /^-|^\d|^[A-Z]+$/;

function stripPrefixes(segment: string): string | undefined {
  const words = shellWords(segment);
  let wrapperSeen = false;
  let i = 0;
  while (i < words.length) {
    const word = words[i] as Word;
    if (word.op) break;
    if (ASSIGNMENT.test(word.value)) {
      i += 1;
      continue;
    }
    if (WRAPPERS.has(word.value)) {
      wrapperSeen = true;
      i += 1;
      continue;
    }
    if (wrapperSeen && WRAPPER_ARG.test(word.value)) {
      i += 1;
      continue;
    }
    break;
  }
  return 0 < i && i < words.length ? segment.slice((words[i] as Word).start) : undefined;
}

/**
 * Extracts redirect and cat/head/tail/sed/tee file targets in source order.
 * Deny/ask only: $HOME is not expanded, relative targets resolve against cwd
 * even after cd, and heredoc body lines are tokenized like commands and can
 * over-match. cp/mv destinations are not checked.
 */
export function shellPathTargets(
  command: string,
): Array<{ tool: "read" | "write" | "edit"; path: string }> {
  const targets: Array<{ tool: "read" | "write" | "edit"; path: string }> = [];
  for (const segment of splitCommand(command)) {
    const words = shellWords(stripPrefixes(segment) ?? segment);
    const first = words[0]?.value;
    const fileCommand =
      first === "cat" || first === "head" || first === "tail" || first === "sed" || first === "tee";
    const tool =
      first === "tee"
        ? "write"
        : first === "sed" &&
            words.some((word) => word.value.startsWith("-i") || word.value.startsWith("--in-place"))
          ? "edit"
          : "read";
    let redirects: Array<"read" | "write"> = [];
    for (const [index, word] of words.entries()) {
      if (word.op) {
        redirects.push(word.value.includes(">") ? "write" : "read");
      } else if (redirects.length > 0) {
        for (const redirect of redirects) targets.push({ tool: redirect, path: word.value });
        redirects = [];
      } else if (fileCommand && index > 0 && !word.value.startsWith("-")) {
        targets.push({ tool, path: word.value });
      }
    }
  }
  return targets;
}

/**
 * Everything a `bash` pattern is matched against: the whole trimmed command
 * first, then each segment and its prefix-stripped form. Deduplicated.
 * Extra candidates are for deny/ask only.
 */
export function commandCandidates(command: string): string[] {
  const candidates = new Set<string>();
  const whole = command.trim();
  if (whole !== "") candidates.add(whole);
  for (const segment of splitCommand(command)) {
    candidates.add(segment);
    const stripped = stripPrefixes(segment);
    if (stripped !== undefined) candidates.add(stripped);
  }
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
