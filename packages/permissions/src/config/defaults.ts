import type { Config } from "./schema.ts";

/**
 * Permissive by default with a targeted deny list — the shape that suits a
 * guardrail. Read-family tools are deliberately ungated: reading a file
 * destroys nothing, and gating reads generates constant prompts.
 *
 * This literal is the normative default. Spec §5 "Shape" and the package
 * README carry its JSON projection; schema.test.ts asserts they agree.
 */
export const DEFAULT_CONFIG = {
  defaultMode: "allow",
  headlessAsk: "deny",
  outsideCwd: "ask",
  tools: {},
  bash: {
    deny: ["rm -rf *", "git push --force*", "git reset --hard*"],
    ask: ["npm publish*", "git push*"],
    allow: [],
  },
  paths: {
    appliesTo: ["write", "edit"],
    // Deliberately narrow. `deny` is always checked before `allow`, so a broad
    // `.env.*` would swallow `.env.example` and no allow rule could rescue it.
    deny: [".env", ".env.local", ".env.*.local", "**/.env", "**/.env.local"],
    ask: [".github/**"],
    allow: [],
  },
  // `satisfies`, not `: Config`. The annotation would widen every value to the
  // schema's optional type; `satisfies` type-checks against the schema while
  // keeping the inferred literals, so consumers read the real defaults.
} satisfies Config;
