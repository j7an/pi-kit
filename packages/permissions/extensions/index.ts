import { existsSync, readFileSync } from "node:fs";
import {
  CONFIG_DIR_NAME,
  type ExtensionAPI,
  type ExtensionContext,
  getAgentDir,
} from "@earendil-works/pi-coding-agent";
import {
  APPROVAL_ENTRY,
  type Approval,
  isApproved,
  requestKey,
  restoreApprovals,
} from "../src/approvals.ts";
import { DEFAULT_CONFIG } from "../src/config/defaults.ts";
import { type LoadResult, loadConfig } from "../src/config/load.ts";
import { decide, type PermissionRequest } from "../src/decide.ts";
import { blockReason, describeRequest, gateErrorReason, promptUser } from "../src/prompt.ts";
import { toRequest } from "../src/request.ts";
import { formatStatus } from "../src/status.ts";

const STATUS_KEY = "pi-kit-permissions";

export type ExtensionDeps = {
  agentDir: string;
  configDirName: string;
  exists: (path: string) => boolean;
  readFile: (path: string) => string | undefined;
};

/** The testable gate. Only the default export binds Pi's real config and filesystem. */
export function createExtension(pi: ExtensionAPI, deps: ExtensionDeps): void {
  /** This session's approvals, restored from its entries on session_start. */
  let approvals: Approval[] = [];
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
        : `pi-kit permissions: part of the config was ignored — ${result.problems[0]}`,
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

  /** Remembers an approval and saves it; a failed save still lets the call run. */
  function record(ctx: ExtensionContext, approval: Approval): void {
    approvals.push(approval);
    try {
      pi.appendEntry(APPROVAL_ENTRY, approval);
    } catch (error) {
      ctx.ui.notify(
        `pi-kit permissions: approval not saved, so it may not survive a reload or restart: ${String(error)}`,
        "warning",
      );
    }
  }

  pi.on("session_start", async (_event, ctx) => {
    approvals = restoreApprovals(ctx.sessionManager.getEntries(), ctx.cwd);
    loaded = undefined;
    loaded = load(ctx);
  });

  pi.registerCommand("permissions", {
    description: "Show the permission rules in force and where they come from",
    handler: async (_args, ctx) => {
      if (!ctx.hasUI) return;
      ctx.ui.notify(
        formatStatus(
          ensureLoaded(ctx),
          approvals.map((approval) => approval.description),
        ),
        "info",
      );
    },
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
      if (isApproved(approvals, request)) return undefined;

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
        record(ctx, {
          kind: "exact",
          tool: request.tool,
          value: requestKey(request),
          description: describeRequest(request),
          cwd: ctx.cwd,
        });
        return undefined;
      }
      if (typeof answer === "object" && "prefix" in answer) {
        record(ctx, {
          kind: "prefix",
          tool: request.tool,
          value: answer.prefix,
          description: `${request.tool}: ${answer.prefix} …`,
          cwd: ctx.cwd,
        });
        return undefined;
      }
      if (answer === "once") return undefined;

      const note =
        typeof answer === "object" && "note" in answer ? ` The user said: ${answer.note}` : "";
      return {
        block: true,
        reason: `${blockReason(decision, request, {
          headless: false,
          forcedAskProblem,
        })} Approval was not granted.${note}`,
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
