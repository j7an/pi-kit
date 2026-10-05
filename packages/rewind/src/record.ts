import { resolvePath } from "./path.ts";
import type { Fs, Store } from "./store.ts";

export const RECORD_TYPE = "pi-kit-rewind";
export type RewindRecord = { path: string; before: string | null; after: string | null };
export type RecorderDeps = {
  fs: Fs;
  store: Store;
  append(record: RewindRecord): void;
  warn(message: string): void;
};

export function createRecorder(deps: RecorderDeps) {
  const pending = new Map<string, { path: string; before: string | null }>();
  const warned = new Set<string>();

  function capture(path: string): string | null {
    const bytes = deps.fs.readFile(path);
    return bytes === undefined ? null : deps.store.put(bytes);
  }

  function warn(path: string, error: unknown): void {
    if (warned.has(path)) return;
    warned.add(path);
    try {
      const reason = error instanceof Error ? error.message : String(error);
      deps.warn(`pi-kit rewind: ${path} won't be restorable (${reason})`);
    } catch {
      // Notification failures must not interrupt the tool either.
    }
  }

  return {
    onToolCall(
      event: { toolName: string; toolCallId: string; input: Record<string, unknown> },
      cwd: string,
    ): void {
      if (event.toolName !== "write" && event.toolName !== "edit") return;
      if (typeof event.input.path !== "string") return;
      let path = event.input.path;
      try {
        path = resolvePath(path, cwd);
        pending.set(event.toolCallId, { path, before: capture(path) });
      } catch (error) {
        warn(path, error);
      }
    },
    onToolResult(event: { toolCallId: string }): void {
      const entry = pending.get(event.toolCallId);
      if (!entry) return;
      pending.delete(event.toolCallId);
      try {
        deps.append({ ...entry, after: capture(entry.path) });
      } catch (error) {
        warn(entry.path, error);
      }
    },
  };
}
