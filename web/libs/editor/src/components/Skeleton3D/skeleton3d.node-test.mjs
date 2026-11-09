// Dependency-free: node --test --test-isolation=none web/libs/editor/src/components/Skeleton3D/skeleton3d.node-test.mjs
import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";
import { test } from "node:test";
const load = async (name) => import(`data:text/javascript;base64,${Buffer.from(await readFile(new URL(name, import.meta.url))).toString("base64")}`);
const { adaptSkeleton, normalizeJoint, readSkeletonSnapshot, listSkeletonSources, createFrameCache, reconstructionKey, createReconstructionRunner } = await load("adapter.js");
const { requestReconstruction } = await load("request.js");
const config = { cameras: [0, 1, 2, 3].map((slot) => ({ slot, image_width: 640, image_height: 480, calibration: {} })) };
const point = (id, x, y, group = "") => ({ id, x, y, group, image: "img", index: 0, width: 1280, height: 960, labels: ["left big toe"] });
const snapshot = (points, edges = []) => ({ points, edges });

test("four independent quadrant groups map percentages to calibration pixels", () => {
  const result = adaptSkeleton(snapshot([point("a", 25, 25, "a"), point("b", 75, 25, "b"), point("c", 25, 75, "c"), point("d", 75, 75, "d")]), config);
  assert.equal(result.error, null);
  assert.deepEqual(result.observations, [0, 1, 2, 3].map((slot) => ({ slot, joint: "l_big_toe", x: 320, y: 240 })));
});
test("each camera can be excluded from triangulation without modifying 2D annotations", () => {
  const points = [
    point("a", 25, 25, "person"),
    point("b", 75, 25, "person"),
    point("c", 25, 75, "person"),
    point("d", 75, 75, "person"),
  ];
  const input = snapshot(points);
  const original = JSON.stringify(input);
  const all = adaptSkeleton(input, config);
  const noTopRight = adaptSkeleton(input, config, [0, 2, 3]);
  assert.deepEqual(all.observations.map((o) => o.slot), [0, 1, 2, 3]);
  assert.deepEqual(noTopRight.observations.map((o) => o.slot), [0, 2, 3]);
  assert.equal(noTopRight.error, null);
  assert.equal(JSON.stringify(input), original);
  const onlyPair = adaptSkeleton(input, config, [1, 3]);
  assert.deepEqual(onlyPair.observations.map((o) => o.slot), [1, 3]);
  assert.equal(onlyPair.error, null);
  assert.match(adaptSkeleton(input, config, [2]).error, /at least two cameras/i);
  assert.match(adaptSkeleton(input, config, []).error, /at least two cameras/i);
  assert.deepEqual(adaptSkeleton(input, config, [0, 1, 2, 3]).observations, all.observations);
});

test("disabled camera annotations never block remaining valid cameras", () => {
  const invalid = { ...point("bad", 75, 25), x: 130 };
  const input = snapshot([point("a", 25, 25), invalid, point("c", 25, 75)]);
  assert.match(adaptSkeleton(input, config).error, /invalid/);
  const without = adaptSkeleton(input, config, [0, 2, 3]);
  assert.equal(without.error, null);
  assert.deepEqual(without.observations.map((o) => o.slot), [0, 2]);
});
test("rejects mixed people, multiple images and bad dimensions", () => {
  const a = point("a", 10, 20, "one");
  const b = { ...point("b", 20, 30, "two"), labels: ["l_heel"] };
  assert.match(adaptSkeleton(snapshot([a, b]), config).error, /Ambiguous/);
  assert.match(adaptSkeleton(snapshot([a, { ...b, image: "other" }]), config).error, /multiple image/);
  assert.match(adaptSkeleton(snapshot([{ ...a, width: undefined }]), config).error, /dimensions/);
  assert.match(adaptSkeleton(snapshot([{ ...a, height: 500 }]), config).error, /aspect ratios/);
});
test("duplicate joints keep the point nearest the body and are reported", () => {
  const near = { ...point("n", 32, 32), labels: ["left big toe"] };
  const stray = { ...point("s", 44, 44), labels: ["left big toe"] };
  const result = adaptSkeleton(snapshot([
    { ...point("h", 30, 30), labels: ["l_heel"] },
    { ...point("k", 30, 46), labels: ["l_knee"] },
    near, stray,
  ]), config);
  assert.equal(result.error, null);
  const toe = result.observations.find((o) => o.joint === "l_big_toe");
  assert.ok(Math.abs(toe.x - 409.6) < 1e-6, `kept the nearby toe, got ${toe.x}`);
  assert.match(result.notes[0], /Duplicate joint l_big_toe in slot 0/);
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
  // Stale empty selectedHistory must not hide populated active annotation.
  assert.equal(readSkeletonSnapshot(store).annotation, "ann");
  assert.equal(readSkeletonSnapshot(store).points.length, 1);
  selected.regionStore.regions = [];
  assert.equal(readSkeletonSnapshot(store).points.length, 0);
});
test("empty selected annotation falls back to populated prediction and allows explicit source selection", () => {
  const make = (id, type, count) => ({
    id, type, createdBy: id,
    regionStore: { regions: Array.from({ length: count }, (_, index) => ({
      ...point(id + index, 30, 30), type: "keypointregion",
      parent: { name: "img", findImageEntity: () => ({ imageLoaded: true, naturalWidth: 1280, naturalHeight: 960 }) },
    })) },
    relationStore: { relations: [] },
  });
  const empty = make("empty", "annotation", 0);
  const predicted = make("pred", "prediction", 3);
  const annotated = make("annot", "annotation", 4);
  const store = {
    task: { id: 1923 },
    annotationStore: { selected: empty, selectedHistory: null, annotations: [empty, annotated], predictions: [predicted] },
  };
  assert.deepEqual(listSkeletonSources(store).map((s) => s.id), ["annot", "pred"]);
  assert.equal(readSkeletonSnapshot(store).annotation, "annot");
  assert.equal(readSkeletonSnapshot(store, "pred").points.length, 3);
  assert.equal(readSkeletonSnapshot(store, "pred").annotation, "pred");
  assert.equal(readSkeletonSnapshot(store, "removed").annotation, "annot");
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
test("frame cache is bounded, private and exact to task/annotation/calibration/observations", () => {
  const cache = createFrameCache(2);
  const input = (task, x, calibration = "A") => ({
    task, annotation: "ann", config: { calibration },
    observations: [{ slot: 0, joint: "nose", x, y: 12 }], edges: [],
  });
  const first = reconstructionKey(input(1, 10));
  const second = reconstructionKey(input(2, 10));
  const third = reconstructionKey(input(3, 10));
  assert.notEqual(first, second);
  assert.notEqual(first, reconstructionKey(input(1, 11)));
  assert.notEqual(first, reconstructionKey(input(1, 10, "B")));
  const a = { joints: [{ joint: "nose" }] };
  cache.set(first, a);
  cache.set(second, { joints: [{ joint: "nose" }] });
  assert.equal(cache.size, 2);
  assert.equal(cache.get(first), a); // refresh LRU
  cache.set(third, { joints: [{ joint: "nose" }] });
  assert.equal(cache.get(second), undefined);
  assert.equal(cache.get(first), a);
  cache.set("bad", { joints: [] });
  assert.equal(cache.get("bad"), undefined);
  cache.clear();
  assert.equal(cache.size, 0);
});

test("fast frame switching uses a private cache and ignores stale responses", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const cache = createFrameCache(8);
  const calls = [], states = [];
  const task = (number) => ({
    task: number, annotation: "a", config: { endpoint: "/reconstruct" },
    observations: [{ slot: 0, joint: "nose", x: number, y: 0 }], edges: [],
  });
  let clock = 1000;
  const runner = createReconstructionRunner({
    cache, delay: 220, fastDelay: 35, minInterval: 150, now: () => clock,
    onState: (state) => states.push(state),
    request: (input, sequence, signal) => new Promise((resolve) => calls.push({ input, sequence, signal, resolve })),
  });
  runner.update(task(1));
  t.mock.timers.tick(34);
  assert.equal(calls.length, 0);
  t.mock.timers.tick(1);
  assert.equal(calls.length, 1);
  calls[0].resolve({ joints: [{ joint: "nose" }] });
  await Promise.resolve();
  assert.equal(states.at(-1).status, "ready");
  runner.update(task(2));
  clock += 160;
  t.mock.timers.tick(35);
  assert.equal(calls.length, 2);
  runner.update(task(3));
  assert.equal(calls[1].signal.aborted, true);
  clock += 160;
  t.mock.timers.tick(35);
  assert.equal(calls.length, 3);
  calls[1].resolve({ joints: [{ joint: "stale" }] });
  calls[2].resolve({ joints: [{ joint: "latest" }] });
  await Promise.resolve();
  assert.deepEqual(states.at(-1).data.joints, [{ joint: "latest" }]);
  assert.equal(cache.size, 2);
  runner.update(task(1));
  assert.equal(states.at(-1).cached, true);
  assert.equal(calls.length, 3);
  runner.update(task(1)); // unchanged
  assert.equal(calls.length, 3);
  runner.dispose();
});

test("rapid edits are coalesced and paced before server requests", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let clock = 5000;
  const calls = [];
  const runner = createReconstructionRunner({
    request: (input) => { calls.push(input); return Promise.resolve({ joints: [] }); },
    onState: () => {}, delay: 220, fastDelay: 35, minInterval: 150, now: () => clock,
  });
  const input = (x) => ({ task: 7, annotation: "x", config: {}, observations: [{ x }], edges: [] });
  runner.update(input(1));
  t.mock.timers.tick(35);
  assert.equal(calls.length, 1);
  clock += 20;
  runner.update(input(2));
  runner.update(input(3));
  runner.update(input(4));
  t.mock.timers.tick(219);
  assert.equal(calls.length, 1);
  clock += 220;
  t.mock.timers.tick(1);
  assert.equal(calls.length, 2);
  assert.equal(calls[1].observations[0].x, 4);
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
