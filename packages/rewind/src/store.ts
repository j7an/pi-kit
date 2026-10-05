import { createHash } from "node:crypto";
import { join } from "node:path";

export type Stat = {
  isSymbolicLink: boolean;
  nlink: number;
  mode: number;
  mtimeMs: number;
};

export type Fs = {
  readFile(path: string): Uint8Array | undefined;
  writeFile(path: string, data: Uint8Array, mode: number): void;
  rename(from: string, to: string): void;
  unlink(path: string): void;
  mkdir(path: string, mode: number): void;
  lstat(path: string): Stat | undefined;
  readdir(path: string): string[];
  utimes(path: string, timeMs: number): void;
};

export type Store = {
  put(bytes: Uint8Array): string;
  get(sha: string): Uint8Array | undefined;
  sweep(): void;
};

export const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

export function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export function blobRoot(agentDir: string): string {
  return join(agentDir, "pi-kit-rewind", "blobs");
}

export function createStore(agentDir: string, fs: Fs, now: () => number): Store {
  const root = blobRoot(agentDir);
  return {
    put(bytes) {
      fs.mkdir(root, 0o700);
      const sha = sha256(bytes);
      const path = join(root, sha);
      if (fs.lstat(path)) {
        fs.utimes(path, now());
      } else {
        const temp = `${path}.tmp-${now()}`;
        fs.writeFile(temp, bytes, 0o600);
        fs.rename(temp, path);
      }
      return sha;
    },
    get(sha) {
      return fs.readFile(join(root, sha));
    },
    sweep() {
      try {
        for (const name of fs.readdir(root)) {
          try {
            const path = join(root, name);
            const stat = fs.lstat(path);
            if (stat && now() - stat.mtimeMs > MAX_AGE_MS) fs.unlink(path);
          } catch {
            // Cleanup is best effort; a single inaccessible blob must not stop it.
          }
        }
      } catch {
        // Missing or inaccessible blob directories need no cleanup.
      }
    },
  };
}
