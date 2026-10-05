import { isKeyRelease, isKeyRepeat } from "@earendil-works/pi-tui";

export const WINDOW_MS = 500;

export function createEscapeClear(deps: {
  isEscape(data: string): boolean;
  now(): number;
  isIdle(): boolean;
  getText(): string;
  clear(): void;
}): (data: string) => { consume: true } | undefined {
  let lastEscape: number | undefined;
  return (data) => {
    if (
      !deps.isEscape(data) ||
      isKeyRelease(data) ||
      isKeyRepeat(data) ||
      !deps.isIdle() ||
      deps.getText().trim() === ""
    )
      return;
    const now = deps.now();
    if (lastEscape !== undefined && now - lastEscape <= WINDOW_MS) {
      deps.clear();
      lastEscape = undefined;
      return { consume: true };
    }
    lastEscape = now;
  };
}
