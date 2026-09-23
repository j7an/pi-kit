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

## Development

```bash
pnpm install
pnpm check        # typecheck, lint, knip, test — run before pushing
pnpm test         # node --test
pnpm format       # biome
```

Node 22.19 or newer; CI tests 22.19.0 and 24. Pi 0.85.1 is the pinned
qualification version.

## Licence

MIT
