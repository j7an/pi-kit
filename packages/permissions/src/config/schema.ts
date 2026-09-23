import { type Static, Type } from "typebox";
import { Check, Errors } from "typebox/value";

const ModeSchema = Type.Union([Type.Literal("allow"), Type.Literal("ask"), Type.Literal("deny")]);

/**
 * `headlessAsk` defines what `ask` becomes when there is no UI, so "ask" is not
 * a coherent value for it. Rejecting it in the schema beats silently treating
 * it as "deny".
 */
const HeadlessModeSchema = Type.Union([Type.Literal("allow"), Type.Literal("deny")]);

const listOfStrings = () => Type.Optional(Type.Array(Type.String()));

/** Rule sets for `tools` and `bash`. No `appliesTo` — it is meaningless here. */
const RuleSetSchema = Type.Object(
  { deny: listOfStrings(), ask: listOfStrings(), allow: listOfStrings() },
  { additionalProperties: false },
);

/** Rule set for `paths`, which alone supports scoping to a set of tools. */
const PathRuleSetSchema = Type.Object(
  {
    appliesTo: listOfStrings(),
    deny: listOfStrings(),
    ask: listOfStrings(),
    allow: listOfStrings(),
  },
  { additionalProperties: false },
);

const ConfigSchema = Type.Object(
  {
    defaultMode: Type.Optional(ModeSchema),
    headlessAsk: Type.Optional(HeadlessModeSchema),
    outsideCwd: Type.Optional(ModeSchema),
    tools: Type.Optional(RuleSetSchema),
    bash: Type.Optional(RuleSetSchema),
    paths: Type.Optional(PathRuleSetSchema),
  },
  { additionalProperties: false },
);

export type Mode = Static<typeof ModeSchema>;
export type RuleSet = Static<typeof RuleSetSchema>;
export type PathRuleSet = Static<typeof PathRuleSetSchema>;
export type Config = Static<typeof ConfigSchema>;

type ValidationResult = { ok: true; config: Config } | { ok: false; errors: string[] };

/**
 * Validates a parsed JSON value against the config schema.
 *
 * typebox emits one error per failing union member plus a summary `anyOf`
 * error, so errors are deduplicated by location — otherwise a single bad
 * `defaultMode` reports four times.
 */
export function validateConfig(value: unknown): ValidationResult {
  if (Check(ConfigSchema, value)) {
    return { ok: true, config: value };
  }
  const seen = new Set<string>();
  const errors: string[] = [];
  for (const error of Errors(ConfigSchema, value)) {
    const location = error.instancePath || "/";
    if (seen.has(location)) continue;
    seen.add(location);
    errors.push(`${location}: ${error.message}`);
  }
  return { ok: false, errors };
}
