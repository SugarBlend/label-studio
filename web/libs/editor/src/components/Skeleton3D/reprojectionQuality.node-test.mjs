import { readFile } from "node:fs/promises";
import { test } from "node:test";
import assert from "node:assert/strict";

const source = await readFile(new URL("./reprojectionQuality.js", import.meta.url), "utf8");
const { REPROJECTION_WARNING_PX, hasHighReprojectionError, getReprojectionWarnings } =
  await import("data:text/javascript;base64," + Buffer.from(source).toString("base64"));

test("threshold is diagnostic only: 10 px is accepted and values above it are flagged", () => {
  assert.equal(REPROJECTION_WARNING_PX, 10);
  assert.equal(hasHighReprojectionError({ rms_reprojection_error_px: 10 }), false);
  assert.equal(hasHighReprojectionError({ rms_reprojection_error_px: 10.001 }), true);
  assert.equal(hasHighReprojectionError({ rms_reprojection_error_px: 300 }), true);
});

test("all high-error joints are reported, even when most of the pose is unreliable", () => {
  const joints = [
    { joint: "l_big_toe", position: [1, 2, 3], rms_reprojection_error_px: 13 },
    { joint: "r_small_toe", position: [2, 3, 4], rms_reprojection_error_px: 250 },
    { joint: "neck", position: [0, 0, 1], rms_reprojection_error_px: 1 },
  ];
  assert.deepEqual(getReprojectionWarnings({ joints }).map((j) => j.joint),
    ["l_big_toe", "r_small_toe"]);
  assert.deepEqual(getReprojectionWarnings(null), []);
});

test("missing/nonfinite errors are not silently categorized as high", () => {
  assert.equal(hasHighReprojectionError({ rms_reprojection_error_px: null }), false);
  assert.equal(hasHighReprojectionError({ rms_reprojection_error_px: Number.NaN }), false);
  assert.equal(hasHighReprojectionError({ rms_reprojection_error_px: Infinity }), false);
});
