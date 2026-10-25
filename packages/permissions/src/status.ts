import { DEFAULT_CONFIG } from "./config/defaults.ts";
import type { LoadResult } from "./config/load.ts";
import type { Config } from "./config/schema.ts";

const HEADER = "pi-kit permissions (loaded at session start; edits take effect in a new session)";

function row(label: string, value: string): string {
  return `  ${label.padEnd(16)}${value}`;
}

/** An empty list is meaningful (`appliesTo: []` gates no tool), so it reads as "none". */
function joined(values: string[]): string {
  return values.length > 0 ? values.join(", ") : "none";
}

/** One entry per line; continuation lines of a multi-line entry stay inside the section. */
function entries(values: string[]): string[] {
  return (values.length > 0 ? values : ["none"]).map(
    (value) => `  ${value.replaceAll("\n", "\n    ")}`,
  );
}

/** What one layer sets, as written: scalars first, then each non-empty rule list. */
function layerRows(config: Config): string[] {
  const rows: string[] = [];
  for (const key of ["defaultMode", "headlessAsk", "outsideCwd"] as const) {
    const value = config[key];
    if (value !== undefined) rows.push(row(key, value));
  }
  if (config.paths?.appliesTo !== undefined) {
    rows.push(row("paths appliesTo", joined(config.paths.appliesTo)));
  }
  for (const dimension of ["tools", "bash", "paths"] as const) {
    for (const list of ["deny", "ask", "allow"] as const) {
      const patterns = config[dimension]?.[list];
      if (patterns !== undefined && patterns.length > 0) {
        rows.push(row(`${dimension} ${list}`, patterns.join(", ")));
      }
    }
  }
  return rows;
}

/** The `/permissions` listing: effective settings, each layer's own rules, approvals, problems. */
export function formatStatus(result: LoadResult, approvals: string[]): string {
  const { config } = result;
  const appliesTo = config.paths?.appliesTo ?? DEFAULT_CONFIG.paths.appliesTo;
  const settings = [
    `defaultMode ${config.defaultMode ?? DEFAULT_CONFIG.defaultMode}`,
    `headlessAsk ${config.headlessAsk ?? DEFAULT_CONFIG.headlessAsk}`,
    `outsideCwd ${config.outsideCwd ?? DEFAULT_CONFIG.outsideCwd}`,
    `path rules apply to: ${joined(appliesTo)}`,
  ].join(" · ");

  const out = [HEADER, settings + (result.forcedAsk ? " (forced: config invalid)" : ""), ""];
  for (const layer of result.layers) {
    out.push(
      layer.path === undefined ? layer.name : `${layer.name}  ${layer.path} — ${layer.status}`,
    );
    if (layer.config !== undefined) out.push(...layerRows(layer.config));
  }
  out.push("", "Allowed for this session");
  out.push(...entries(approvals));
  out.push("Problems");
  out.push(...entries(result.problems));
  return out.join("\n");
}
