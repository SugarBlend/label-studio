import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";
import { test } from "node:test";

// Self-contained import works with node --test and the branch's non-module package config.
const source = await readFile(new URL("./topology.js", import.meta.url), "utf8");
const { standardEdges } = await import("data:text/javascript;base64," + Buffer.from(source).toString("base64"));
const has = (a, b) => standardEdges.some(([x, y]) => (x === a && y === b) || (x === b && y === a));

test("each ankle connects directly to both toes and heel", () => {
  for (const side of ["l", "r"]) {
    for (const joint of ["big_toe", "small_toe", "heel"]) {
      assert.ok(has(side + "_ankle", side + "_" + joint), side + " ankle -> " + joint);
    }
    assert.ok(has(side + "_big_toe", side + "_small_toe"));
  }
});

test("neck never connects directly to central hip", () => {
  assert.ok(!has("neck", "hip"));
  assert.ok(has("neck", "l_shoulder"));
  assert.ok(has("neck", "r_shoulder"));
});

test("standard topology has no duplicate undirected edges", () => {
  const keys = standardEdges.map(([a, b]) => [a, b].sort().join("|"));
  assert.equal(new Set(keys).size, keys.length);
});
