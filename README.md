# pi-kit

Extensions that bring the most useful features shared by Claude Code and
Codex to the [Pi coding agent](https://pi.mariozechner.at/).

## Philosophy

Pi ships a minimal core and leaves features such as permissions, checkpoints,
plan mode and sub-agents to extensions. pi-kit fills those gaps where Claude
Code and Codex agree a feature is worth having: one independent, tested
package per feature.

Pi packages run with full system access, and their dependencies install with
them. pi-kit keeps external runtime dependencies few. One is added only when
it simplifies the code, and it must be well maintained, widely used, and light
on transitive dependencies. Packages ship raw TypeScript with no build step.

**Extensions define core; core does not define extensions.** Code joins the
shared library, `@pi-kit/shared`, only when a second extension needs it.

## Packages

| Package | What it does |
|---|---|
| [`@pi-kit/permissions`](packages/permissions) | Allow / ask / deny guardrail over Pi's built-in tools |
| [`@pi-kit/rewind`](packages/rewind) | Rewind code and conversation to an earlier prompt |
| [`@pi-kit/shared`](packages/shared) | Code shared by the extensions above; installed with them, not on its own |

## Development

```bash
pnpm install
pnpm check        # typecheck, lint, knip, test — run before pushing
pnpm test         # node --test
pnpm format       # biome
```

Node 22.19 or newer; CI tests 22.19.0 and 24. Pull requests test the Pi
version pinned in the root `package.json`; a weekly job tests the newest patch
of each Pi minor released or superseded in the last 30 days.

## Licence

MIT
