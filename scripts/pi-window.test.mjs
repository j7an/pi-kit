import assert from "node:assert/strict";
import { test } from "node:test";
import { piWindow } from "./pi-window.mjs";

// Pi 0.83–0.87 release dates, with synthetic version labels to keep the pin in one place.
const released = {
  "1.83.0": "2026-07-29T22:30:23.309Z",
  "1.84.0": "2026-08-06T11:10:04.579Z",
  "1.84.1": "2026-08-07T06:01:32.966Z",
  "1.84.2": "2026-08-14T10:09:06.966Z",
  "1.84.3": "2026-08-24T11:09:37.600Z",
  "1.84.4": "2026-08-28T22:07:57.753Z",
  "1.85.0": "2026-09-04T10:18:05.208Z",
  "1.85.1": "2026-09-05T12:17:19.281Z",
  "1.86.0": "2026-09-19T23:14:16.198Z",
  "1.86.1": "2026-09-20T11:16:39.121Z",
  "1.87.0": "2026-09-21T16:51:53.584Z",
  "1.87.1": "2026-09-22T19:42:48.221Z",
};

test("newest minor plus minors superseded in the last 30 days", () => {
  assert.deepEqual(piWindow(released, Date.parse("2026-09-23T00:00:00Z")), [
    "1.87.1",
    "1.86.1",
    "1.85.1",
    "1.84.4",
  ]);
  assert.deepEqual(piWindow(released, Date.parse("2026-10-05T12:00:00Z")), [
    "1.87.1",
    "1.86.1",
    "1.85.1",
  ]);
});

test("backport, missing .0, numeric patch order, prerelease, metadata, boundary", () => {
  const time = {
    created: "2026-01-01T00:00:00.000Z",
    modified: "2026-02-20T00:00:00.000Z",
    "1.1.0": "2026-01-01T00:00:00.000Z",
    "1.2.1": "2026-01-31T00:00:00.000Z",
    "1.2.9": "2026-02-05T00:00:00.000Z",
    "1.3.0": "2026-02-10T00:00:00.000Z",
    "1.2.10": "2026-02-15T00:00:00.000Z",
    "1.4.0-beta.1": "2026-02-20T00:00:00.000Z",
  };
  assert.deepEqual(piWindow(time, Date.parse("2026-03-02T00:00:00.000Z")), [
    "1.3.0",
    "1.2.10",
    "1.1.0",
  ]);
});

test("a window of fewer than two versions throws", () => {
  const time = { "1.0.0": "2026-01-01T00:00:00.000Z", "1.1.0": "2026-01-02T00:00:00.000Z" };
  assert.throws(() => piWindow(time, Date.parse("2026-03-01T00:00:00.000Z")), /at least 2/);
});
