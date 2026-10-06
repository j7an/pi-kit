# pi-kit

A personal, self-audited toolkit of extensions for the
[Pi coding agent](https://pi.mariozechner.at/).

## Philosophy

Pi packages run with full system access. Installing a third-party extension
means executing arbitrary code you have not read. Auditing a 16,000-line
package is not realistic; writing a small one you understand is. Every
package here is small enough to re-read in one sitting, ships raw TypeScript
with no build step, and has no runtime dependencies unless one is exact-pinned,
bundled, zero-transitive, script-free, and re-audited on every bump.

**Extensions define core; core does not define extensions.** There is no
shared library until a second extension demonstrates a genuine common need.

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
