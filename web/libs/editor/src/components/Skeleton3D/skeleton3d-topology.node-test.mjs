import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";
import { test } from "node:test";

const source = await readFile(new URL("./topology.js", import.meta.url), "utf8");
const { uniqueRelationEdges, boneColorOf, colorOf, BONE, LEFT, RIGHT } = await import("data:text/javascript;base64," + Buffer.from(source).toString("base64"));

test("no Relations means no 3D bones, even with HALPE-named joints", () => {
  const visible = new Set(["l_ankle", "l_big_toe", "neck", "hip"]);
  assert.deepEqual(uniqueRelationEdges([], visible), []);
  assert.deepEqual(uniqueRelationEdges(undefined, visible), []);
});

test("only saved Relations become bones, regardless of joint names", () => {
  const visible = new Set(["custom_tip", "custom_root", "neck", "hip", "extra"]);
  assert.deepEqual(uniqueRelationEdges([
    ["custom_root", "custom_tip"], ["custom_tip", "custom_root"],
    ["neck", "hip"], ["extra", "not_reconstructed"], ["extra", "extra"],
  ], visible), [["custom_root", "custom_tip"], ["neck", "hip"]]);
});

test("invalid, absent and duplicate Relations do not create other bones", () => {
  const visible = new Set(["a", "b", "c"]);
  assert.deepEqual(uniqueRelationEdges([
    ["a", "b"], ["b", "a"], ["a", "c"], ["missing", "c"],
    ["a"], [null, "c"], ["c", "c"],
  ], visible), [["a", "b"], ["a", "c"]]);
});

test("a central-to-left bone is blue independent of Relation direction", () => {
  assert.equal(boneColorOf("neck", "left_shoulder"), LEFT);
  assert.equal(boneColorOf("l_shoulder", "neck"), LEFT);
  assert.equal(boneColorOf("neck", "r_shoulder"), RIGHT);
  assert.equal(boneColorOf("right_shoulder", "neck"), RIGHT);
});

test("same-side, mixed-side and neutral Relations have deterministic colors", () => {
  assert.equal(boneColorOf("left_shoulder", "left_elbow"), LEFT);
  assert.equal(boneColorOf("right_hip", "r_knee"), RIGHT);
  assert.equal(boneColorOf("left_hip", "right_hip"), BONE);
  assert.equal(boneColorOf("neck", "hip"), BONE);
  assert.equal(boneColorOf("point_A", "point_B"), BONE);
  assert.equal(colorOf("left_heel"), LEFT);
  assert.equal(colorOf("right_wrist"), RIGHT);
  assert.equal(colorOf("custom_joint"), BONE);
});
