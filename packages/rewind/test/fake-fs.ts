import { basename, dirname } from "node:path";
import type { Fs, Stat } from "../src/store.ts";

type File = { data: Uint8Array; mode: number; mtimeMs: number };

export function fakeFs(initial: Record<string, Uint8Array> = {}): Fs & {
  files: Map<string, File>;
  dirs: Map<string, number>;
  links: Set<string>;
  hardLinks: Set<string>;
} {
  const files = new Map<string, File>();
  const dirs = new Map<string, number>();
  const links = new Set<string>();
  const hardLinks = new Set<string>();
  for (const [path, data] of Object.entries(initial)) {
    files.set(path, { data: data.slice(), mode: 0o600, mtimeMs: 0 });
  }
  return {
    files,
    dirs,
    links,
    hardLinks,
    readFile: (path) => files.get(path)?.data.slice(),
    writeFile(path, data, mode) {
      files.set(path, { data: data.slice(), mode, mtimeMs: 0 });
    },
    rename(from, to) {
      const file = files.get(from);
      if (!file) throw new Error(`Missing file: ${from}`);
      files.set(to, file);
      files.delete(from);
    },
    unlink(path) {
      files.delete(path);
    },
    mkdir(path, mode) {
      let directory = path;
      while (!dirs.has(directory)) {
        dirs.set(directory, mode);
        const parent = dirname(directory);
        if (parent === directory) break;
        directory = parent;
      }
    },
    lstat(path): Stat | undefined {
      const file = files.get(path);
      const mode = file?.mode ?? dirs.get(path);
      if (mode === undefined && !links.has(path)) return undefined;
      return {
        isSymbolicLink: links.has(path),
        nlink: hardLinks.has(path) ? 2 : 1,
        mode: mode ?? 0o777,
        mtimeMs: file?.mtimeMs ?? 0,
      };
    },
    readdir(path) {
      return [...new Set([...files.keys(), ...dirs.keys(), ...links])]
        .filter((entry) => entry !== path && dirname(entry) === path)
        .map((entry) => basename(entry));
    },
    utimes(path, timeMs) {
      const file = files.get(path);
      if (!file) throw new Error(`Missing file: ${path}`);
      file.mtimeMs = timeMs;
    },
  };
}
