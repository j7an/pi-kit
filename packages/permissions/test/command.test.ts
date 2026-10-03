import assert from "node:assert/strict";
import { test } from "node:test";
import { commandCandidates, matchCommand, splitCommand } from "../src/match/command.ts";

const SPLIT_CASES: Array<[label: string, command: string, expected: string[]]> = [
  ["single command", "rm -rf dist", ["rm -rf dist"]],
  ["&&", "cd build && rm -rf .", ["cd build", "rm -rf ."]],
  ["lone & splits", "npm run dev & git push --force", ["npm run dev", "git push --force"]],
  ["2>&1 does not split", "make 2>&1", ["make 2>&1"]],
  ["&> does not split", "cmd &> log", ["cmd &> log"]],
  [">&2 does not split", "echo x >&2", ["echo x >&2"]],
  ["<&3 does not split", "cat <&3", ["cat <&3"]],
  ["quoted & does not split", 'echo "a & b"', ['echo "a & b"']],
  ["blank runs collapse", "rm  -rf\tdist", ["rm -rf dist"]],
  ["quoted blanks are kept", 'echo "a  b"', ['echo "a  b"']],
  ["escaped blank then blank keeps both", "echo x\\  y", ["echo x\\  y"]],
  [";", "make clean; rm -rf dist", ["make clean", "rm -rf dist"]],
  ["||", "test -d x || mkdir x", ["test -d x", "mkdir x"]],
  ["|", "cat log | grep error", ["cat log", "grep error"]],
  ["|&", "make |& tee out", ["make", "tee out"]],
  ["newline", "npm ci\nnpm test", ["npm ci", "npm test"]],
  ["apostrophe in a comment", "# it's stale\nrm -rf dist", ["# it's stale", "rm -rf dist"]],
  [
    "inline comment quotes",
    "npm test # don't cache\ngit push --force",
    ["npm test # don't cache", "git push --force"],
  ],
  [
    "operators inside a comment",
    "echo ready # ignored; rm -rf dist\necho done",
    ["echo ready # ignored; rm -rf dist", "echo done"],
  ],
  ["quoted hash is literal", "echo '#'; rm -rf dist", ["echo '#'", "rm -rf dist"]],
  ["hash within a word is literal", "echo foo#bar; rm -rf dist", ["echo foo#bar", "rm -rf dist"]],
  ["escaped hash is literal", "echo \\#; rm -rf dist", ["echo \\#", "rm -rf dist"]],
  [
    "escaped blank does not start a new word",
    "echo x\\ #; rm -rf dist",
    ["echo x\\ #", "rm -rf dist"],
  ],
  [
    "comment at end of input",
    "echo ready # don't split; anything",
    ["echo ready # don't split; anything"],
  ],
  ["mixed", "a && b; c | d || e", ["a", "b", "c", "d", "e"]],
  ["double quotes protect operators", 'echo "a && b"', ['echo "a && b"']],
  ["single quotes protect operators", "echo 'x; y | z'", ["echo 'x; y | z'"]],
  ["backslash escapes an operator", "echo a \\&\\& b", ["echo a \\&\\& b"]],
  ["backslash inside double quotes", 'echo "a \\" && b"', ['echo "a \\" && b"']],
  ["empty segments dropped", "a &&  && b", ["a", "b"]],
  ["trailing operator dropped", "npm test &&", ["npm test"]],
  ["leading operator dropped", "; rm -rf x", ["rm -rf x"]],
  ["whitespace trimmed", "  a  ;  b  ", ["a", "b"]],
  ["empty command", "   ", []],
  ["subshell operators split too", "echo $(a; b)", ["echo $(a", "b)"]],
  ["unterminated quote swallows the rest", "echo 'a && rm -rf x", ["echo 'a && rm -rf x"]],
];

for (const [label, command, expected] of SPLIT_CASES) {
  test(`splitCommand: ${label}`, () => {
    assert.deepEqual(splitCommand(command), expected);
  });
}

test("commandCandidates: whole command first, then segments, deduplicated", () => {
  assert.deepEqual(commandCandidates("cd build && rm -rf ."), [
    "cd build && rm -rf .",
    "cd build",
    "rm -rf .",
  ]);
  assert.deepEqual(commandCandidates("  ls  "), ["ls"]);
  assert.deepEqual(commandCandidates(""), []);
});

test("commandCandidates: a bare prefix adds no candidate", () => {
  assert.deepEqual(commandCandidates("FOO=1"), ["FOO=1"]);
  assert.deepEqual(commandCandidates("nohup"), ["nohup"]);
  assert.deepEqual(commandCandidates("timeout 30"), ["timeout 30"]);
  assert.deepEqual(commandCandidates("FOO=1 rm x"), ["FOO=1 rm x", "rm x"]);
});

const MATCH_CASES: Array<
  [label: string, pattern: string, command: string, expected: string | undefined]
> = [
  ["past timeout", "git push --force*", "timeout 30 git push --force", "git push --force"],
  ["past timeout options and signal", "rm -rf *", "timeout -s KILL 30 rm -rf x", "rm -rf x"],
  ["past an assignment", "rm -rf *", "FOO=1 rm -rf x", "rm -rf x"],
  ["past a quoted assignment", "git push*", 'GIT_SSH_COMMAND="ssh -i k" git push', "git push"],
  ["past chained prefixes", "rm -rf *", "env A=1 nohup rm -rf x", "rm -rf x"],
  ["past nice -n", "rm -rf *", "nice -n 10 rm -rf x", "rm -rf x"],
  ["non-wrapper first word is not stripped", "rm -rf *", "echo rm -rf x", undefined],
  ["past a single-quoted assignment", "rm -rf *", "FOO='a b' rm -rf x", "rm -rf x"],
  ["past double-quoted escapes", "rm -rf *", 'FOO="a\\" b" rm -rf x', "rm -rf x"],
  ["empty quoted word stops stripping", "rm -rf *", "env '' rm -rf x", undefined],
  ["redirection stops stripping", "rm -rf *", "FOO=x>.env rm -rf x", undefined],
  ["quoted redirection remains in an assignment", "rm -rf *", 'FOO="x>y" rm -rf x', "rm -rf x"],
  ["trailing wildcard on a plain command", "rm -rf *", "rm -rf /tmp/build", "rm -rf /tmp/build"],
  ["catches the second segment of &&", "rm -rf *", "cd build && rm -rf .", "rm -rf ."],
  ["catches the second segment of ;", "rm -rf *", "make clean; rm -rf dist", "rm -rf dist"],
  ["catches a piped segment", "git push*", "echo y | git push --force", "git push --force"],
  ["whole command wins when it matches", "cd *", "cd build && ls", "cd build && ls"],
  ["quoted operator does not create a segment", "rm -rf *", 'echo "x && rm -rf y"', undefined],
  [
    "ignores surrounding whitespace",
    "npm publish*",
    "  npm publish --dry-run  ",
    "npm publish --dry-run",
  ],
  ["similar-looking different command", "rm -rf *", "rmdir /tmp", undefined],
  ["no wildcard means exact", "git status", "git status --short", undefined],
  ["wildcard admits arguments", "git status*", "git status --short", "git status --short"],
  ["regex metacharacters are literal", "echo $HOME", "echo $HOME", "echo $HOME"],
  ["regex metacharacters are literal (negative)", "echo $HOME", "echo XHOME", undefined],
  ["star matches everything", "*", "anything at all", "anything at all"],
];

for (const [label, pattern, command, expected] of MATCH_CASES) {
  test(`matchCommand: ${label}`, () => {
    assert.equal(matchCommand(pattern, command), expected);
  });
}

test('matchCommand: candidates "whole" ignores segments', () => {
  assert.equal(matchCommand("ls", "ls && curl example.com", "whole"), undefined);
  assert.equal(matchCommand("ls*", "ls && curl example.com", "whole"), "ls && curl example.com");
  assert.equal(matchCommand("ls", "  ls  ", "whole"), "ls");
  assert.equal(matchCommand("npm test", "timeout 30 npm test", "whole"), undefined);
});
