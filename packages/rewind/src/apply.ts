import { randomUUID } from "node:crypto";
import { dirname } from "node:path";
import type { PlanStep } from "./plan.ts";
import { type Fs, type Stat, type Store, sha256 } from "./store.ts";

export type ApplyResult = { restored: string[]; skipped: { path: string; reason: string }[] };

export async function applyPlan(
  steps: readonly PlanStep[],
  deps: {
    fs: Fs;
    store: Store;
    confirm(title: string, message: string): Promise<boolean>;
    now(): number;
  },
): Promise<ApplyResult> {
  const result: ApplyResult = { restored: [], skipped: [] };
  const ready: { step: PlanStep; stat: Stat | undefined; conflict: boolean }[] = [];
  const skip = (path: string, reason: string) => result.skipped.push({ path, reason });
  const failure = (path: string, error: unknown) =>
    skip(path, error instanceof Error ? error.message : String(error));

  for (const step of steps) {
    try {
      const stat = deps.fs.lstat(step.path);
      if (stat?.isSymbolicLink) {
        skip(step.path, "symlink");
      } else if (stat && stat.nlink > 1) {
        skip(step.path, "hard link");
      } else {
        const bytes = deps.fs.readFile(step.path);
        const current = bytes === undefined ? null : sha256(bytes);
        ready.push({ step, stat, conflict: current !== step.expected });
      }
    } catch (error) {
      failure(step.path, error);
    }
  }

  const conflicts = ready.filter(({ conflict }) => conflict);
  const approved =
    conflicts.length === 0 ||
    (await deps.confirm(
      "Overwrite files changed outside the agent?",
      conflicts.map(({ step }) => step.path).join("\n"),
    ));
  for (const { step, stat, conflict } of ready) {
    if (conflict && !approved) {
      skip(step.path, "changed outside the agent");
      continue;
    }
    try {
      if (step.target === null) {
        if (stat) deps.fs.unlink(step.path);
      } else {
        const bytes = deps.store.get(step.target);
        if (bytes === undefined) {
          skip(step.path, "snapshot missing");
          continue;
        }
        deps.fs.mkdir(dirname(step.path), 0o755);
        const temp = `${step.path}.pi-kit-rewind-${deps.now()}-${randomUUID()}`;
        let written = false;
        try {
          deps.fs.writeFile(temp, bytes, stat?.mode ?? 0o644);
          written = true;
          deps.fs.rename(temp, step.path);
        } catch (error) {
          // An exclusive-create failure belongs to another file, not this restore.
          if (written || (error as NodeJS.ErrnoException)?.code !== "EEXIST") {
            try {
              deps.fs.unlink(temp);
            } catch {
              // Preserve the original failure if cleanup cannot remove the temp.
            }
          }
          throw error;
        }
      }
      result.restored.push(step.path);
    } catch (error) {
      failure(step.path, error);
    }
  }
  return result;
}

export function formatResult(result: ApplyResult): string {
  const restored = `Restored ${result.restored.length} files`;
  return result.skipped.length === 0
    ? restored
    : `${restored}, skipped ${result.skipped.length}: ${result.skipped.map(({ path, reason }) => `${path} (${reason})`).join(", ")}`;
}
