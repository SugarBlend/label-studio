/**
 * Remembers zoom level and position of Image tags between tasks.
 *
 * Image models are recreated for every task, so the view state has to live
 * outside of them. It is stored per tag name, and position is kept relative
 * to the image (which point of the image is in the center of the viewport),
 * so it is restored correctly even if the panel size has changed.
 */

/**
 * @typedef {Object} ZoomState
 * @property {number} naturalWidth
 * @property {number} naturalHeight
 * @property {number} zoom - value of `currentZoom`
 * @property {number} fx - viewport center X as a fraction of image width
 * @property {number} fy - viewport center Y as a fraction of image height
 */

/** @type {Map<string, ZoomState>} */
const memory = new Map();

/** Image nodes that finished their initial sizing and may record their zoom */
const readyNodes = new WeakSet();

export const rememberZoom = (key, state) => {
  if (!key || !state) return;
  if (![state.zoom, state.fx, state.fy].every(Number.isFinite)) return;
  memory.set(key, state);
};

export const recallZoom = (key) => memory.get(key);

export const forgetZoom = (key) => memory.delete(key);

export const markZoomReady = (node) => readyNodes.add(node);

export const isZoomReady = (node) => readyNodes.has(node);

/** Restore only for images of the same size (frames of one video, one camera, etc) */
export const canRestoreZoom = (state, naturalWidth, naturalHeight) =>
  !!state && state.naturalWidth === naturalWidth && state.naturalHeight === naturalHeight;

/**
 * After a restore the editor layout may still settle for a few frames
 * (container height, scrollbars). During this window every resize re-applies
 * exactly the restored view instead of approximating it, and intermediate
 * states are not recorded. Any user zoom/pan ends the window immediately.
 */
const HOLD_MS = 1000;

/** @type {WeakMap<object, {state: ZoomState, until: number}>} */
const held = new WeakMap();

export const holdRestoredZoom = (node, state) => held.set(node, { state, until: Date.now() + HOLD_MS });

export const getHeldZoom = (node) => {
  const entry = held.get(node);
  if (!entry) return null;
  if (Date.now() > entry.until) {
    held.delete(node);
    return null;
  }
  return entry.state;
};

export const releaseHeldZoom = (node) => held.delete(node);
