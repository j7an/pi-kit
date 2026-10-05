import {
  closeSync,
  fchmodSync,
  lstatSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import {
  type ExtensionAPI,
  type ExtensionContext,
  getAgentDir,
} from "@earendil-works/pi-coding-agent";
import { matchesKey } from "@earendil-works/pi-tui";
import { applyPlan, formatResult } from "../src/apply.ts";
import { createEscapeClear } from "../src/escape.ts";
import { type PlanStep, planRestore } from "../src/plan.ts";
import { createRecorder, RECORD_TYPE } from "../src/record.ts";
import { createStore, type Fs, sha256 } from "../src/store.ts";

export type ExtensionDeps = {
  agentDir: string;
  fs: Fs;
  now(): number;
  isEscape(data: string): boolean;
};

export const RESTORE_BOTH = "Restore code and conversation";
export const RESTORE_CONVERSATION = "Restore conversation only";
export const RESTORE_CODE = "Restore code only";
export const CANCEL = "Cancel";
export const FORK_RESTORE = "Restore code";
export const FORK_KEEP = "Keep current code";

export function createExtension(pi: ExtensionAPI, deps: ExtensionDeps): void {
  const store = createStore(deps.agentDir, deps.fs, deps.now);
  let recorder: ReturnType<typeof createRecorder> | undefined;
  let keptPlan: PlanStep[] | undefined;

  function capture(ctx: ExtensionContext) {
    recorder ??= createRecorder({
      fs: deps.fs,
      store,
      append: (record) => pi.appendEntry(RECORD_TYPE, record),
      warn: (message) => ctx.ui.notify(message, "warning"),
    });
    return recorder;
  }

  function plan(ctx: ExtensionContext, oldLeafId: string | null, targetId: string | null) {
    return planRestore(
      ctx.sessionManager.getEntries(),
      oldLeafId ? ctx.sessionManager.getBranch(oldLeafId) : [],
      targetId ? ctx.sessionManager.getBranch(targetId) : [],
      (path) => {
        const bytes = deps.fs.readFile(path);
        return bytes === undefined ? null : sha256(bytes);
      },
    );
  }

  async function restore(steps: PlanStep[], ctx: ExtensionContext): Promise<void> {
    const result = await applyPlan(steps, {
      fs: deps.fs,
      store,
      now: deps.now,
      confirm: (title, message) => ctx.ui.confirm(title, message),
    });
    ctx.ui.notify(formatResult(result), "info");
  }

  pi.on("tool_call", async (event, ctx) => {
    capture(ctx).onToolCall(event, ctx.cwd);
  });
  pi.on("tool_result", async (event, ctx) => {
    capture(ctx).onToolResult(event);
  });
  pi.registerCommand("rewind", {
    description: "Rewind code and/or conversation to an earlier prompt",
    handler: async (_args, ctx) => {
      if (!ctx.hasUI) return;
      if (!ctx.isIdle()) {
        ctx.ui.notify("pi-kit rewind: wait for the response to finish", "warning");
        return;
      }
      const prompts = ctx.sessionManager
        .getBranch()
        .filter((entry) => entry.type === "message" && entry.message.role === "user");
      const choices = prompts
        .map((entry, index) => {
          const content =
            entry.type === "message" && entry.message.role === "user" ? entry.message.content : "";
          const text =
            typeof content === "string"
              ? content
              : content
                  .filter((part) => part.type === "text")
                  .map((part) => part.text)
                  .join(" ");
          return {
            id: entry.id,
            label: `${index + 1}. ${text.split("\n")[0]?.slice(0, 72) ?? ""}`,
          };
        })
        .reverse();
      if (choices.length === 0) {
        ctx.ui.notify("Nothing to rewind", "info");
        return;
      }
      const answer = await ctx.ui.select(
        "Rewind",
        choices.map((choice) => choice.label),
      );
      const target = choices.find((choice) => choice.label === answer);
      if (target) {
        if (target.id === ctx.sessionManager.getLeafId()) {
          // Native same-leaf navigation skips hooks; custom metadata adds no context.
          pi.appendEntry("pi-kit-rewind-navigation", {});
        }
        await ctx.navigateTree(target.id);
      }
    },
  });

  pi.on("session_start", async (_event, ctx) => {
    recorder = undefined;
    keptPlan = undefined;
    store.sweep();
    if (ctx.mode === "tui") {
      ctx.ui.onTerminalInput(
        createEscapeClear({
          isEscape: deps.isEscape,
          now: deps.now,
          isIdle: () => ctx.isIdle(),
          getText: () => ctx.ui.getEditorText(),
          clear: () => ctx.ui.setEditorText(""),
        }),
      );
    }
  });

  pi.on("session_before_tree", async (event, ctx) => {
    keptPlan = undefined;
    if (!ctx.hasUI) return;
    const steps = plan(ctx, event.preparation.oldLeafId, event.preparation.targetId);
    if (steps.length === 0) return;
    const answer = await ctx.ui.select(`Rewind: ${steps.length} files changed since this point`, [
      RESTORE_BOTH,
      RESTORE_CONVERSATION,
      RESTORE_CODE,
      CANCEL,
    ]);
    if (answer === RESTORE_BOTH) {
      keptPlan = steps;
      return;
    }
    if (answer === RESTORE_CONVERSATION) return;
    if (answer === RESTORE_CODE) await restore(steps, ctx);
    return { cancel: true };
  });

  pi.on("session_tree", async (_event, ctx) => {
    const steps = keptPlan;
    keptPlan = undefined;
    if (steps) await restore(steps, ctx);
  });

  pi.on("session_before_fork", async (event, ctx) => {
    if (!ctx.hasUI) return;
    const entry = ctx.sessionManager.getEntry(event.entryId);
    // A user prompt has no file mutation; include it to resolve its captured boundary.
    // Pi still controls the native before/at conversation position.
    const targetId =
      event.position === "at" || (entry?.type === "message" && entry.message.role === "user")
        ? event.entryId
        : (entry?.parentId ?? null);
    const steps = plan(ctx, ctx.sessionManager.getLeafId(), targetId);
    if (steps.length === 0) return;
    if (!ctx.isIdle()) {
      ctx.ui.notify(
        "pi-kit rewind: wait for the response to finish, then fork again to restore code",
        "warning",
      );
      return { cancel: true };
    }
    const answer = await ctx.ui.select(`Rewind: ${steps.length} files changed since this point`, [
      FORK_RESTORE,
      FORK_KEEP,
      CANCEL,
    ]);
    if (answer === FORK_KEEP) return;
    if (answer === FORK_RESTORE) {
      await restore(steps, ctx);
      return;
    }
    return { cancel: true };
  });
}

/** Only Pi's factory binds the native filesystem. Reads preserve errors other than absence. */
export default function (pi: ExtensionAPI): void {
  const fs: Fs = {
    readFile(path) {
      try {
        return readFileSync(path);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
        throw error;
      }
    },
    writeFile(path, data, mode) {
      const fd = openSync(path, "wx", mode);
      try {
        writeFileSync(fd, data);
        fchmodSync(fd, mode);
      } finally {
        closeSync(fd);
      }
    },
    rename: renameSync,
    unlink: unlinkSync,
    mkdir: (path, mode) => {
      mkdirSync(path, { recursive: true, mode });
    },
    lstat(path) {
      const stat = lstatSync(path, { throwIfNoEntry: false });
      return (
        stat && {
          isSymbolicLink: stat.isSymbolicLink(),
          nlink: stat.nlink,
          mode: stat.mode,
          mtimeMs: stat.mtimeMs,
        }
      );
    },
    readdir: readdirSync,
    utimes: (path, timeMs) => utimesSync(path, timeMs / 1000, timeMs / 1000),
  };
  createExtension(pi, {
    agentDir: getAgentDir(),
    fs,
    now: Date.now,
    isEscape: (data) => matchesKey(data, "escape"),
  });
}
