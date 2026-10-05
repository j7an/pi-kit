import assert from "node:assert/strict";
import { test } from "node:test";
import { matchesKey } from "@earendil-works/pi-tui";
import { createEscapeClear, WINDOW_MS } from "../src/escape.ts";

function fixture(
  text = "draft",
  idle = true,
  isEscape: (data: string) => boolean = (data) => data === "escape",
) {
  let time = 0;
  let clears = 0;
  const input = createEscapeClear({
    isEscape,
    now: () => time,
    isIdle: () => idle,
    getText: () => text,
    clear: () => {
      clears++;
      text = "";
    },
  });
  return {
    input,
    tick: (ms: number) => {
      time += ms;
    },
    clears: () => clears,
    setText: (value: string) => {
      text = value;
    },
  };
}

test("two escapes within 500 ms on a non-empty prompt clear it and consume the second", () => {
  const f = fixture();
  assert.equal(f.input("escape"), undefined);
  f.tick(500);
  assert.deepEqual(f.input("escape"), { consume: true });
  assert.equal(f.clears(), 1);
});

test("escapes 600 ms apart do not clear", () => {
  const f = fixture();
  assert.equal(f.input("escape"), undefined);
  f.tick(WINDOW_MS + 100);
  assert.equal(f.input("escape"), undefined);
  assert.equal(f.clears(), 0);
});

for (const text of ["", " \n "]) {
  test(`empty prompt passes through: ${JSON.stringify(text)}`, () => {
    const f = fixture(text);
    assert.equal(f.input("escape"), undefined);
    f.tick(100);
    assert.equal(f.input("escape"), undefined);
    assert.equal(f.clears(), 0);
  });
}

test("busy agent passes through", () => {
  const f = fixture("draft", false);
  assert.equal(f.input("escape"), undefined);
  f.tick(100);
  assert.equal(f.input("escape"), undefined);
  assert.equal(f.clears(), 0);
});

test("non-escape input passes through and does not reset the timer", () => {
  const f = fixture();
  assert.equal(f.input("escape"), undefined);
  f.tick(100);
  assert.equal(f.input("x"), undefined);
  f.tick(100);
  assert.deepEqual(f.input("escape"), { consume: true });
  assert.equal(f.clears(), 1);
});

test("a third escape after a clear does not clear again", () => {
  const f = fixture();
  f.input("escape");
  f.tick(100);
  f.input("escape");
  f.setText("new draft");
  f.tick(100);
  assert.equal(f.input("escape"), undefined);
  assert.equal(f.clears(), 1);
});

for (const [kind, event] of [
  ["release", "\x1b[27;1:3u"],
  ["repeat", "\x1b[27;1:2u"],
] as const) {
  test(`Kitty Escape ${kind} does not count as a second press`, () => {
    const f = fixture("draft", true, (data) => matchesKey(data, "escape"));
    assert.equal(f.input("\x1b[27u"), undefined);
    f.tick(90);
    assert.equal(f.input(event), undefined);
    assert.equal(f.clears(), 0);
    f.tick(90);
    assert.deepEqual(f.input("\x1b[27u"), { consume: true });
    assert.equal(f.clears(), 1);
  });
}

test("Kitty Escape release without a press does not arm clearing", () => {
  const f = fixture("draft", true, (data) => matchesKey(data, "escape"));
  assert.equal(f.input("\x1b[27;1:3u"), undefined);
  f.tick(90);
  assert.equal(f.input("\x1b[27u"), undefined);
  assert.equal(f.clears(), 0);
});
