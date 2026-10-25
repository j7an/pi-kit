import { DEFAULT_CONFIG } from "./config/defaults.ts";
import type { LoadResult } from "./config/load.ts";
import type { Config } from "./config/schema.ts";

const HEADER = "pi-kit permissions (loaded at session start; edits take effect in a new session)";

function row(label: string, value: string): string {
  return `  ${label.padEnd(16)}${value}`;
}

/** What one layer sets, as written: scalars first, then each non-empty rule list. */
function layerRows(config: Config): string[] {
  const rows: string[] = [];
  for (const key of ["defaultMode", "headlessAsk", "outsideCwd"] as const) {
    const value = config[key];
    if (value !== undefined) rows.push(row(key, value));
  }
  if (config.paths?.appliesTo !== undefined) {
    rows.push(row("paths appliesTo", config.paths.appliesTo.join(", ")));
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
    `path rules apply to: ${appliesTo.join(", ")}`,
  ].join(" · ");

  const out = [HEADER, settings + (result.forcedAsk ? " (forced: config invalid)" : ""), ""];
  for (const layer of result.layers) {
    out.push(
      layer.path === undefined ? layer.name : `${layer.name}  ${layer.path} — ${layer.status}`,
    );
    if (layer.config !== undefined) out.push(...layerRows(layer.config));
  }
  out.push("", "Allowed for this session");
  out.push(...(approvals.length > 0 ? approvals : ["none"]).map((line) => `  ${line}`));
  out.push("Problems");
  out.push(...(result.problems.length > 0 ? result.problems : ["none"]).map((line) => `  ${line}`));
  return out.join("\n");
}
