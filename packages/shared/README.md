# @pi-kit/shared

Code used by more than one pi-kit extension. This is not a Pi extension and
is not meant to be installed directly — extensions depend on it.

| Export | Function | Behaviour |
|---|---|---|
| `@pi-kit/shared/path` | `expandHome` | Expands a bare `~` or leading `~/` to the home directory. |
| `@pi-kit/shared/path` | `resolvePath` | Resolves a tool-supplied path against cwd, normalising traversal, Unicode spaces, a leading `@`, home prefixes, and file URLs. |

Code moves here only when a second package needs it.

Extensions pin an exact version, so auditing an extension means auditing
exactly the shared version it pins.

## Supported versions

Node 22.19 or newer.

## Dependencies

None.

## More from pi-kit

Part of [pi-kit](https://github.com/j7an/pi-kit), extensions that bring the
most useful features shared by Claude Code and Codex to the Pi coding agent.

| Package | What it does |
|---|---|
| [`@pi-kit/permissions`](https://www.npmjs.com/package/@pi-kit/permissions) | Allow / ask / deny guardrail over Pi's built-in and MCP tools |
| [`@pi-kit/rewind`](https://www.npmjs.com/package/@pi-kit/rewind) | Rewind code and conversation to an earlier prompt |

## Licence

MIT
