import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";
import { test } from "node:test";

const source = await readFile(new URL("./topology.js", import.meta.url), "utf8");
const { uniqueRelationEdges } = await import("data:text/javascript;base64," + Buffer.from(source).toString("base64"));

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
