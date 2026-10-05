import assert from "node:assert/strict";
import { test } from "node:test";
import { createEscapeClear, WINDOW_MS } from "../src/escape.ts";

function fixture(text = "draft", idle = true) {
  let time = 0;
  let clears = 0;
  const input = createEscapeClear({
    isEscape: (data) => data === "escape",
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
