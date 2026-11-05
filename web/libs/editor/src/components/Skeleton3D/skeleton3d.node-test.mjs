// Dependency-free: node --test --test-isolation=none web/libs/editor/src/components/Skeleton3D/skeleton3d.node-test.mjs
import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";
import { test } from "node:test";
const load = async (name) => import(`data:text/javascript;base64,${Buffer.from(await readFile(new URL(name, import.meta.url))).toString("base64")}`);
const { adaptSkeleton, normalizeJoint, readSkeletonSnapshot, createReconstructionRunner } = await load("adapter.js");
const { requestReconstruction } = await load("request.js");
const config = { cameras: [0, 1, 2, 3].map((slot) => ({ slot, image_width: 640, image_height: 480, calibration: {} })) };
const point = (id, x, y, group = "") => ({ id, x, y, group, image: "img", index: 0, width: 1280, height: 960, labels: ["left big toe"] });
const snapshot = (points, edges = []) => ({ points, edges });

test("four independent quadrant groups map percentages to calibration pixels", () => {
  const result = adaptSkeleton(snapshot([point("a", 25, 25, "a"), point("b", 75, 25, "b"), point("c", 25, 75, "c"), point("d", 75, 75, "d")]), config);
  assert.equal(result.error, null);
  assert.deepEqual(result.observations, [0, 1, 2, 3].map((slot) => ({ slot, joint: "l_big_toe", x: 320, y: 240 })));
});
test("rejects mixed people, duplicate joints, multiple images and bad dimensions", () => {
  const a = point("a", 10, 20, "one");
  const b = { ...point("b", 20, 30, "two"), labels: ["l_heel"] };
  assert.match(adaptSkeleton(snapshot([a, b]), config).error, /Ambiguous/);
  assert.match(adaptSkeleton(snapshot([a, { ...a, id: "b" }]), config).error, /duplicate/);
  assert.match(adaptSkeleton(snapshot([a, { ...b, image: "other" }]), config).error, /multiple image/);
  assert.match(adaptSkeleton(snapshot([{ ...a, width: undefined }]), config).error, /dimensions/);
  assert.match(adaptSkeleton(snapshot([{ ...a, height: 500 }]), config).error, /aspect ratios/);
});
test("resizing and display rotation preserve pixel observations; edges stay within views", () => {
  const a = { ...point("a", 0, 0), width: 2560, height: 1920, rotation: 90 };
  const b = { ...point("b", 49, 49), labels: ["l_heel"] };
  const c = point("c", 50, 50);
  const result = adaptSkeleton(snapshot([a, b, c], [["a", "b"], ["a", "c"]]), config);
  assert.equal(result.error, null);
  assert.deepEqual(result.observations[0], { slot: 0, joint: "l_big_toe", x: 0, y: 0 });
  assert.deepEqual(result.observations[2], { slot: 3, joint: "l_big_toe", x: 0, y: 0 });
  assert.deepEqual(result.edges, [["l_big_toe", "l_heel"]]);
});
test("normalizes common foot aliases", () => {
  for (const name of ["Left Big Toe", "leftBigToe", "big_toe_left", "l_bigtoe", "BigToe_L"]) assert.equal(normalizeJoint(name), "l_big_toe");
  assert.equal(normalizeJoint("Right Little Toe"), "r_small_toe");
});
test("reads live coordinates, history, deletion and relations without serializing", () => {
  const region = { ...point("a", 12, 20), type: "keypointregion", parent: { name: "img", findImageEntity: () => ({ imageLoaded: true, naturalWidth: 1280, naturalHeight: 960 }) } };
  const selected = { id: "ann", regionStore: { regions: [region] }, relationStore: { relations: [{ node1: { id: "a" }, node2: { id: "b" } }] } };
  const store = { task: { id: 1 }, annotationStore: { selected } };
  assert.equal(readSkeletonSnapshot(store).points[0].x, 12);
  region.x = 18;
  assert.equal(readSkeletonSnapshot(store).points[0].x, 18);
  store.annotationStore.selectedHistory = { ...selected, id: "history", regionStore: { regions: [] } };
  assert.equal(readSkeletonSnapshot(store).annotation, "history");
  assert.equal(readSkeletonSnapshot(store).points.length, 0);
  delete store.annotationStore.selectedHistory;
  selected.regionStore.regions = [];
  assert.equal(readSkeletonSnapshot(store).points.length, 0);
});
test("latest-only runner debounces, aborts and ignores stale task/annotation/calibration results", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const calls = [], states = [];
  const runner = createReconstructionRunner({ onState: (s) => states.push(s), request: (input, sequence, signal) => new Promise((resolve) => calls.push({ input, sequence, signal, resolve })) });
  runner.update({ task: 1 });
  runner.update({ task: 2 });
  t.mock.timers.tick(199);
  assert.equal(calls.length, 0);
  t.mock.timers.tick(1);
  assert.equal(calls.length, 1);
  runner.update({ task: 2, annotation: "next", calibration: "new" });
  assert.equal(calls[0].signal.aborted, true);
  t.mock.timers.tick(200);
  calls[0].resolve({ stale: true });
  calls[1].resolve({ fresh: true });
  await Promise.resolve();
  assert.deepEqual(states.at(-1).data, { fresh: true });
  runner.update({ error: "Deleted points" });
  assert.equal(states.at(-1).data, null);
  t.mock.timers.tick(200);
  assert.equal(calls.length, 2);
  runner.dispose();
});
test("request enforces same origin, CSRF, observation-only body and response sequence", async () => {
  const old = { window: globalThis.window, document: globalThis.document, fetch: globalThis.fetch };
  globalThis.window = { location: { href: "https://example.test/task", origin: "https://example.test" } };
  globalThis.document = { cookie: "csrftoken=abc", querySelector: () => null };
  const calls = [];
  globalThis.fetch = async (...args) => { calls.push(args); return { ok: true, json: async () => ({ joints: [], sequence: 3 }) }; };
  try {
    await assert.rejects(requestReconstruction({ config: { endpoint: "https://evil.test/api" } }, 3), /same-origin/);
    assert.equal(calls.length, 0);
    await requestReconstruction({ config: { endpoint: "/api/reconstruct" }, observations: [{ slot: 0 }], edges: [] }, 3);
    assert.equal(calls[0][1].headers["X-CSRFToken"], "abc");
    assert.equal(calls[0][1].redirect, "error");
    assert.deepEqual(JSON.parse(calls[0][1].body), { observations: [{ slot: 0 }], sequence: 3 });
    await assert.rejects(requestReconstruction({ config: { endpoint: "/api/reconstruct" } }, 4), /sequence/);
  } finally { Object.assign(globalThis, old); }
});
