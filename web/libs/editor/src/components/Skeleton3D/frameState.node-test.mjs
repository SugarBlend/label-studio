import { readFile } from "node:fs/promises";
import { test } from "node:test";
import assert from "node:assert/strict";

const source = await readFile(new URL("./frameState.js", import.meta.url), "utf8");
const { mergeFrameState } = await import(
  "data:text/javascript;base64," + Buffer.from(source).toString("base64")
);

const old = { status: "ready", data: { joints: [{ joint: "l_ankle" }] }, stale: false };

test("frame switch never blanks an already-rendered 3D skeleton", () => {
  const updated = mergeFrameState(old, { status: "pending", data: null });
  assert.equal(updated.status, "pending");
  assert.equal(updated.stale, true);
  assert.equal(updated.data, old.data);
});

test("missing next-frame keypoints keep old pose with explicit stale status", () => {
  for (const next of [
    { status: "invalid", error: "No matching joints", data: null },
    { status: "error", error: "HTTP 503", data: null },
    { status: "ready", data: { joints: [] } },
  ]) {
    const updated = mergeFrameState(old, next);
    assert.equal(updated.stale, true);
    assert.equal(updated.data, old.data);
  }
});

test("new valid pose replaces the old pose and clears stale flag", () => {
  const fresh = { joints: [{ joint: "r_ankle" }] };
  const updated = mergeFrameState(old, { status: "ready", data: fresh });
  assert.equal(updated.stale, false);
  assert.equal(updated.data, fresh);
});

test("no previous pose is not mislabeled as stale", () => {
  const updated = mergeFrameState({ status: "pending", data: null }, { status: "error", error: "offline", data: null });
  assert.equal(updated.stale, false);
  assert.equal(updated.data, null);
});
