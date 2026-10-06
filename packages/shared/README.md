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
