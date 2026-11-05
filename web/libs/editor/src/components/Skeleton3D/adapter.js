/** Read-only adapter for the branch's percentage-based KeyPointRegion models.
 * ImageView rotates the Konva Stage, NOT region x/y. These coordinates already
 * refer to the original unrotated mosaic; applying image_rotation again is wrong.
 */
export function normalizeJoint(label) {
  return String(label ?? "").trim().replace(/([a-z])([A-Z])/g, "$1_$2").toLowerCase()
    .replace(/[\s-]+/g, "_")
    .replace(/^(.*)_(left|right|l|r)$/, "$2_$1")
    .replace(/^left_?/, "l_").replace(/^right_?/, "r_")
    .replace(/_bigtoe$/, "_big_toe").replace(/_(smalltoe|little_toe|littletoe)$/, "_small_toe");
}

export function readSkeletonSnapshot(store) {
  const annotation = store.annotationStore.selectedHistory ?? store.annotationStore.selected;
  return {
    task: store.task?.id,
    annotation: annotation?.id,
    points: (annotation?.regionStore.regions ?? []).filter((r) => r.type === "keypointregion").map((r) => {
      const image = r.parent;
      const entity = image?.findImageEntity?.(r.item_index ?? 0);
      return {
        id: r.id, group: r.parentID || "", image: image?.name,
        index: r.item_index ?? 0, x: r.x, y: r.y, labels: Array.from(r.labels ?? []),
        width: entity?.imageLoaded ? entity.naturalWidth : r._rawResult?.original_width,
        height: entity?.imageLoaded ? entity.naturalHeight : r._rawResult?.original_height,
        rotation: entity?.rotation ?? 0,
      };
    }),
    edges: (annotation?.relationStore.relations ?? []).map((r) => [r.node1?.id, r.node2?.id]),
  };
}

export function adaptSkeleton(snapshot, config) {
  const fail = (error) => ({ observations: [], edges: [], notes: [], error });
  const cameras = config?.cameras;
  if (!Array.isArray(cameras) || cameras.length !== 4 || new Set(cameras.map((c) => c.slot)).size !== 4 ||
      cameras.some((c) => ![0, 1, 2, 3].includes(c.slot) || !Number.isFinite(c.image_width) ||
        !Number.isFinite(c.image_height) || c.image_width <= 0 || c.image_height <= 0)) {
    return fail("Four calibrated camera slots (0–3) are required.");
  }
  if (!snapshot.points.length) return fail("Add matching keypoints in at least two camera slots.");
  if (new Set(snapshot.points.map((p) => `${p.image}:${p.index}`)).size !== 1) {
    return fail("Use a single 2×2 mosaic image; multiple image sources are ambiguous.");
  }
  const observations = [];
  const candidates = new Map();
  const groups = [new Set(), new Set(), new Set(), new Set()];
  const pointsById = new Map();
  for (const point of snapshot.points) {
    if (![point.x, point.y, point.width, point.height].every(Number.isFinite) ||
        point.width <= 1 || point.height <= 1 || point.x < 0 || point.x > 100 || point.y < 0 || point.y > 100) {
      return fail("Keypoint coordinates or original image dimensions are unavailable or invalid.");
    }
    if (point.labels.length !== 1 || !normalizeJoint(point.labels[0])) return fail("Every keypoint needs one joint label.");
    const joint = normalizeJoint(point.labels[0]);
    const column = point.x < 50 ? 0 : 1;
    const row = point.y < 50 ? 0 : 1;
    const slot = row * 2 + column;
    const camera = cameras.find((c) => c.slot === slot);
    // Equal-sized quadrants can be resized, but must not be stretched/cropped.
    if (Math.abs((point.width / point.height) / (camera.image_width / camera.image_height) - 1) > 0.01) {
      return fail(`Slot ${slot}: mosaic quadrant and calibration aspect ratios differ.`);
    }
    groups[slot].add(point.group || "ungrouped");
    const key = `${slot}:${joint}`;
    if (!candidates.has(key)) candidates.set(key, []);
    candidates.get(key).push({
      point,
      observation: {
        slot, joint,
        x: ((point.x / 100 * point.width - column * point.width / 2) / (point.width / 2)) * camera.image_width,
        y: ((point.y / 100 * point.height - row * point.height / 2) / (point.height / 2)) * camera.image_height,
      },
    });
  }
  for (let slot = 0; slot < 4; slot++) {
    if (groups[slot].size > 1) return fail(`Ambiguous person groups in slot ${slot}; only one skeleton per view is supported.`);
  }
  // Duplicated joints are common after auto-labelling: keep the point closest to the
  // slot's median position (the body) and report the rest instead of showing nothing.
  const median = (values) => { const sorted = [...values].sort((a, b) => a - b); return sorted[sorted.length >> 1]; };
  const reference = [0, 1, 2, 3].map((slot) => {
    const points = [...candidates.entries()].filter(([key]) => key.startsWith(`${slot}:`)).flatMap(([, list]) => list);
    return points.length ? [median(points.map((c) => c.observation.x)), median(points.map((c) => c.observation.y))] : null;
  });
  const notes = [];
  for (const [key, list] of candidates) {
    const slot = Number(key.slice(0, key.indexOf(":")));
    const joint = key.slice(key.indexOf(":") + 1);
    let chosen = list[0];
    if (list.length > 1) {
      const [x, y] = reference[slot];
      chosen = list.reduce((best, item) =>
        Math.hypot(item.observation.x - x, item.observation.y - y) < Math.hypot(best.observation.x - x, best.observation.y - y) ? item : best);
      notes.push(`Duplicate joint ${joint} in slot ${slot}: kept the point closest to the body, ignored ${list.length - 1}.`);
    }
    observations.push(chosen.observation);
    pointsById.set(chosen.point.id, chosen.observation);
  }
  const edges = [];
  for (const [a, b] of snapshot.edges) {
    const start = pointsById.get(a);
    const end = pointsById.get(b);
    if (start && end && start.slot === end.slot && start.joint !== end.joint) edges.push([start.joint, end.joint]);
  }
  return { observations, edges, notes, error: null };
}

/** Latest-only scheduling: invalidation aborts immediately, before the debounce. */
export function createReconstructionRunner({ request, onState, delay = 200 }) {
  let generation = 0;
  let timer;
  let controller;
  return {
    update(input) {
      const current = ++generation;
      clearTimeout(timer);
      controller?.abort();
      onState({ status: input.error ? "invalid" : "pending", error: input.error, data: null, notes: input.notes ?? [] });
      if (input.error) return;
      timer = setTimeout(async () => {
        controller = new AbortController();
        try {
          const data = await request(input, current, controller.signal);
          if (current === generation) onState({ status: "ready", data, error: null, notes: input.notes ?? [] });
        } catch (error) {
          if (current === generation && error.name !== "AbortError") onState({ status: "error", data: null, error: error.message, notes: [] });
        }
      }, delay);
    },
    dispose() { ++generation; clearTimeout(timer); controller?.abort(); },
  };
}
