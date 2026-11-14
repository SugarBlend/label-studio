import { readFile } from "node:fs/promises";
import { test } from "node:test";
import assert from "node:assert/strict";

const source = await readFile(new URL("./prefetch-policy.js", import.meta.url), "utf8");
const { getPrefetchPolicy, limitPrefetchUrls } = await import(
  "data:text/javascript;base64," + Buffer.from(source).toString("base64")
);

test("multi-user defaults only prefetch one neighbouring image in each direction", () => {
  assert.deepEqual(getPrefetchPolicy(null), {
    ahead: 1, behind: 1, instant: true, taskData: false,
  });
});

test("user overrides are bounded and speculative mutable task JSON requires opt-in", () => {
  assert.deepEqual(getPrefetchPolicy('{"ahead":999,"behind":99,"taskData":true,"instant":false}'), {
    ahead: 2, behind: 1, instant: false, taskData: true,
  });
  assert.equal(getPrefetchPolicy("{invalid").taskData, false);
  assert.equal(getPrefetchPolicy('{"ahead":-4,"behind":0}').ahead, 0);
  assert.equal(getPrefetchPolicy('{"ahead":-4,"behind":0}').behind, 0);
});

test("image prefetch never fans out past two unique URLs per switch", () => {
  assert.deepEqual(limitPrefetchUrls(["next.jpg", "next.jpg", "prev.jpg", "other.jpg"]), [
    "next.jpg", "prev.jpg",
  ]);
});
