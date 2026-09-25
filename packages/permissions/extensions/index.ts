import { existsSync, readFileSync } from "node:fs";
import {
  CONFIG_DIR_NAME,
  type ExtensionAPI,
  type ExtensionContext,
  getAgentDir,
} from "@earendil-works/pi-coding-agent";
import { DEFAULT_CONFIG } from "../src/config/defaults.ts";
import { type LoadResult, loadConfig } from "../src/config/load.ts";
import { decide, type PermissionRequest } from "../src/decide.ts";
import { blockReason, gateErrorReason, promptUser } from "../src/prompt.ts";
import { toRequest } from "../src/request.ts";

const STATUS_KEY = "pi-kit-permissions";

export type ExtensionDeps = {
  agentDir: string;
  configDirName: string;
  exists: (path: string) => boolean;
  readFile: (path: string) => string | undefined;
};

function sessionKey(req: PermissionRequest): string {
  return `${req.tool}\0${req.command ?? ""}\0${req.rawPaths.join("\0")}`;
}

/** The testable gate. Only the default export binds Pi's real config and filesystem. */
export function createExtension(pi: ExtensionAPI, deps: ExtensionDeps): void {
  const approvals = new Set<string>();
  let loaded: LoadResult | undefined;

  function report(ctx: ExtensionContext, result: LoadResult): void {
    if (result.problems.length === 0) {
      ctx.ui.setStatus(STATUS_KEY, undefined);
      return;
    }
    for (const problem of result.problems) {
      ctx.ui.notify(`pi-kit permissions: ${problem}`, "warning");
    }
    ctx.ui.setStatus(
      STATUS_KEY,
      result.forcedAsk
        ? `pi-kit permissions: defaultMode forced to ask until fixed — ${result.problems[0]}`
        : `pi-kit permissions: a config scope was skipped — ${result.problems[0]}`,
    );
  }

  function load(ctx: ExtensionContext): LoadResult {
    const result = loadConfig({
      cwd: ctx.cwd,
      agentDir: deps.agentDir,
      configDirName: deps.configDirName,
      trusted: ctx.isProjectTrusted(),
      exists: deps.exists,
      readFile: deps.readFile,
    });
    report(ctx, result);
    return result;
  }

  function ensureLoaded(ctx: ExtensionContext): LoadResult {
    if (loaded === undefined) loaded = load(ctx);
    return loaded;
  }

  pi.on("session_start", async (_event, ctx) => {
    approvals.clear();
    loaded = undefined;
    loaded = load(ctx);
  });

  pi.on("tool_call", async (event, ctx) => {
    let request: PermissionRequest;
    let decision: ReturnType<typeof decide>;
    let state: LoadResult;

    try {
      state = ensureLoaded(ctx);
      request = toRequest(event.toolName, event.input as Record<string, unknown>, ctx.cwd);
      decision = decide(state.config, request, ctx.cwd);
    } catch (error) {
      return { block: true, reason: gateErrorReason(error) };
    }

    if (decision.outcome === "allow") return undefined;

    const forcedAskProblem =
      state.forcedAsk && decision.dimension === undefined ? state.problems[0] : undefined;

    if (decision.outcome === "deny") {
      return {
        block: true,
        reason: blockReason(decision, request, { headless: !ctx.hasUI, forcedAskProblem }),
      };
    }

    try {
      if (approvals.has(sessionKey(request))) return undefined;

      if (!ctx.hasUI) {
        const headlessAsk = state.config.headlessAsk ?? DEFAULT_CONFIG.headlessAsk;
        if (headlessAsk === "allow") return undefined;
        return {
          block: true,
          reason: blockReason(decision, request, { headless: true, forcedAskProblem }),
        };
      }

      const answer = await promptUser(ctx.ui, request, decision);
      if (answer === "session") {
        approvals.add(sessionKey(request));
        return undefined;
      }
      if (answer === "once") return undefined;

      return {
        block: true,
        reason: `${blockReason(decision, request, {
          headless: false,
          forcedAskProblem,
        })} Approval was not granted.`,
      };
    } catch (error) {
      return { block: true, reason: gateErrorReason(error) };
    }
  });
}

/** Pi's factory binds the actual config directory and filesystem. */
export default function (pi: ExtensionAPI): void {
  createExtension(pi, {
    agentDir: getAgentDir(),
    configDirName: CONFIG_DIR_NAME,
    exists: (path) => existsSync(path),
    readFile: (path) => (existsSync(path) ? readFileSync(path, "utf-8") : undefined),
  });
}
