import { isAbsolute } from "node:path";
import { RECORD_TYPE, type RewindRecord } from "./record.ts";

export type EntryLike = {
  id: string;
  parentId?: string | null;
  type: string;
  message?: { role: string };
  customType?: string;
  data?: unknown;
};
export type PlanStep = { path: string; target: string | null; expected: string | null };

function isState(value: unknown): value is string | null {
  return value === null || (typeof value === "string" && /^[0-9a-f]{64}$/.test(value));
}

function record(entry: EntryLike): RewindRecord | undefined {
  if (entry.type !== "custom" || entry.customType !== RECORD_TYPE) return;
  const data = entry.data;
  if (typeof data !== "object" || data === null) return;
  if (
    !("path" in data) ||
    typeof data.path !== "string" ||
    !isAbsolute(data.path) ||
    !("before" in data) ||
    !isState(data.before) ||
    !("after" in data) ||
    !isState(data.after)
  ) {
    return;
  }
  return { path: data.path, before: data.before, after: data.after };
}

function updateStates(states: Map<string, string | null>, entries: readonly EntryLike[]): void {
  for (const entry of entries) {
    const data = record(entry);
    if (data) states.set(data.path, data.after);
  }
}

/** Branches are root-first; current returns the disk hash, or null when absent. */
export function planRestore(
  allEntries: readonly EntryLike[],
  oldBranch: readonly EntryLike[],
  targetBranch: readonly EntryLike[],
  current: (path: string) => string | null,
): PlanStep[] {
  const earliest = new Map<string, string | null>();
  const targetEntry = targetBranch.at(-1);
  const targetPromptId =
    targetEntry?.type === "message" && targetEntry.message?.role === "user"
      ? targetEntry.id
      : undefined;
  const promptIds = new Map<string, string>();
  const promptStates = new Map<string, string | null>();
  for (const entry of allEntries) {
    // Entries are append-ordered: inherit the nearest user prompt from the parent.
    // A later user prompt starts its own response, including on abandoned branches.
    const promptId =
      entry.type === "message" && entry.message?.role === "user"
        ? entry.id
        : entry.parentId
          ? promptIds.get(entry.parentId)
          : undefined;
    if (promptId !== undefined) promptIds.set(entry.id, promptId);
    const data = record(entry);
    if (data && !earliest.has(data.path)) earliest.set(data.path, data.before);
    if (
      data &&
      targetPromptId !== undefined &&
      promptId === targetPromptId &&
      !promptStates.has(data.path)
    ) {
      promptStates.set(data.path, data.before);
    }
  }

  let shared = 0;
  while (
    shared < oldBranch.length &&
    shared < targetBranch.length &&
    oldBranch[shared]?.id === targetBranch[shared]?.id
  ) {
    shared++;
  }
  const trunk = new Map(earliest);
  updateStates(trunk, oldBranch.slice(0, shared));
  const expectedStates = new Map(trunk);
  const targetStates = new Map(trunk);
  updateStates(expectedStates, oldBranch.slice(shared));
  updateStates(targetStates, targetBranch.slice(shared));
  for (const [path, before] of promptStates) targetStates.set(path, before);

  const steps: PlanStep[] = [];
  for (const path of earliest.keys()) {
    const target = targetStates.get(path) ?? null;
    const expected = expectedStates.get(path) ?? null;
    try {
      if (target === current(path)) continue;
    } catch {
      // Keep unreadable paths so applyPlan can report their failure per file.
    }
    steps.push({ path, target, expected });
  }
  return steps;
}
