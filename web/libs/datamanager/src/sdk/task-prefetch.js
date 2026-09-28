/**
 * Prefetch neighbouring tasks so switching between them is instant:
 *  - task payload (GET /api/tasks/<id>) of the tasks around the current one;
 *  - their images, downloaded into the shared LSF image cache and pre-decoded.
 *
 * When everything for a task is already in memory, the navigation code skips
 * its loading overlays and "wait for paint" pauses (see `isTaskDataReady` and
 * `areTaskImagesReady`), so the new task replaces the old one immediately.
 *
 * LSF keeps images in a global in-memory cache (`imageCache` from
 * @humansignal/core) keyed by the image `src`. For cloud storages (S3/MinIO)
 * that `src` is the stable `/tasks/<id>/resolve/?fileuri=...` URL, which is
 * exactly what Data Manager already has in `task.data` of every task in the
 * list. The cache stores the bytes as a blob, so it works for both presigned
 * and proxy storage modes.
 *
 * Label stream is not affected: the server picks the next task there.
 */
import { imageCache } from "@humansignal/core";

const DEFAULTS = {
  /** How many tasks after the current one to prefetch */
  ahead: 3,
  /** How many tasks before the current one to prefetch */
  behind: 2,
  /** Skip loading overlays when the target task is already prefetched */
  instant: true,
};

const IMAGE_EXT_RE = /\.(jpe?g|png|gif|bmp|webp|tiff?|avif)$/i;

/**
 * Read overrides from localStorage so behaviour can be tuned without rebuild:
 *   localStorage.setItem("ls:prefetch", JSON.stringify({ ahead: 5, behind: 2, instant: true }))
 * ahead = behind = 0 disables prefetching; instant = false keeps loading overlays.
 */
const getSettings = () => {
  try {
    const raw = window.localStorage?.getItem("ls:prefetch");
    if (!raw) return DEFAULTS;
    const parsed = JSON.parse(raw);
    return {
      ahead: Number.isFinite(parsed?.ahead) ? Math.max(0, parsed.ahead) : DEFAULTS.ahead,
      behind: Number.isFinite(parsed?.behind) ? Math.max(0, parsed.behind) : DEFAULTS.behind,
      instant: typeof parsed?.instant === "boolean" ? parsed.instant : DEFAULTS.instant,
    };
  } catch {
    return DEFAULTS;
  }
};

export const isInstantSwitchEnabled = () => getSettings().instant;

/* ------------------------------------------------------------------ */
/* Image URLs                                                          */
/* ------------------------------------------------------------------ */

/** Decode `fileuri` param of a storage resolve URL (urlsafe base64) */
const decodeFileUri = (url) => {
  const fileuri = url.searchParams.get("fileuri");
  if (!fileuri) return null;
  try {
    const b64 = fileuri.replace(/-/g, "+").replace(/_/g, "/");
    return atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4));
  } catch {
    // old-style (url-quoted) fileuri
    try {
      return decodeURIComponent(fileuri);
    } catch {
      return fileuri;
    }
  }
};

/** True if the value looks like a URL of an image we can prefetch */
export const isImageUrl = (value) => {
  if (typeof value !== "string" || value.length === 0) return false;
  if (value.startsWith("data:") || value.startsWith("blob:")) return false;
  if (!/^(https?:\/\/|\/)/i.test(value)) return false;

  let url;
  try {
    url = new URL(value, window.location.origin);
  } catch {
    return false;
  }

  const original = decodeFileUri(url);
  const path = (original ?? url.pathname).split("?")[0];

  return IMAGE_EXT_RE.test(path);
};

/** Collect image URLs from task data (supports lists and nested objects) */
export const collectImageUrls = (data, depth = 0, result = []) => {
  if (!data || depth > 3) return result;

  if (typeof data === "string") {
    if (isImageUrl(data)) result.push(data);
  } else if (Array.isArray(data)) {
    data.forEach((item) => collectImageUrls(item, depth + 1, result));
  } else if (typeof data === "object") {
    Object.values(data).forEach((item) => collectImageUrls(item, depth + 1, result));
  }

  return result;
};

/** True if the task has images and all of them are already in the image cache */
export const areTaskImagesReady = (task) => {
  if (!task?.data) return false;
  const urls = collectImageUrls(task.data);
  return urls.length > 0 && urls.every((url) => !!imageCache.get(url));
};

/**
 * Keep a few decoded <img> elements alive, so the browser keeps the decoded
 * bitmap and showing the image in LSF does not pay for JPEG/PNG decoding.
 */
const MAX_DECODED = 8;
const decodedImages = new Map(); // url -> HTMLImageElement

const predecode = async (url, blobUrl) => {
  if (!blobUrl || decodedImages.has(url) || typeof Image === "undefined") return;
  const img = new Image();
  img.src = blobUrl;
  try {
    await img.decode?.();
  } catch {
    return;
  }
  decodedImages.set(url, img);
  while (decodedImages.size > MAX_DECODED) {
    decodedImages.delete(decodedImages.keys().next().value);
  }
};

/* ------------------------------------------------------------------ */
/* Task data (GET /api/tasks/<id>) cache                               */
/* ------------------------------------------------------------------ */

/**
 * Prefetched task payloads. Entries are single-use (taken on open) and
 * short-lived, and any write request to the API drops the affected tasks
 * (see `trackApiCall`), so a task is never shown with stale annotations
 * or drafts.
 */
const TASK_DATA_TTL = 60 * 1000;
const taskDataCache = new Map(); // taskId -> { promise, data, timestamp }

const taskKey = (taskID) => String(taskID);

/** Start fetching task data in background; `fetcher` returns a promise of the API payload */
export const prefetchTaskData = (taskID, fetcher) => {
  const key = taskKey(taskID);
  const existing = taskDataCache.get(key);
  if (existing && Date.now() - existing.timestamp < TASK_DATA_TTL) return existing.promise;

  const entry = { timestamp: Date.now(), promise: null, data: null };
  entry.promise = Promise.resolve()
    .then(fetcher)
    .then((data) => {
      // drop failed responses so the regular request runs instead
      if (!data || data.error || (data.$meta?.status ?? 200) >= 400) {
        if (taskDataCache.get(key) === entry) taskDataCache.delete(key);
        return null;
      }
      entry.data = data;
      return data;
    })
    .catch(() => {
      if (taskDataCache.get(key) === entry) taskDataCache.delete(key);
      return null;
    });

  taskDataCache.set(key, entry);
  return entry.promise;
};

/** True if data of this task is already downloaded and can be used right away */
export const isTaskDataReady = (taskID) => {
  const entry = taskDataCache.get(taskKey(taskID));
  return !!entry?.data && Date.now() - entry.timestamp < TASK_DATA_TTL;
};

/**
 * Take (and remove) prefetched task data. Returns a promise of the payload,
 * or null if there is nothing usable — then the caller does a normal request.
 */
export const takePrefetchedTaskData = (taskID) => {
  const key = taskKey(taskID);
  const entry = taskDataCache.get(key);
  if (!entry) return null;
  taskDataCache.delete(key);
  if (Date.now() - entry.timestamp > TASK_DATA_TTL) return null;
  return entry.promise;
};

/** Forget prefetched data of given tasks (or all of them) */
export const invalidatePrefetchedTaskData = (...taskIDs) => {
  if (taskIDs.length === 0) {
    taskDataCache.clear();
    return;
  }
  taskIDs.filter((id) => id !== undefined && id !== null).forEach((id) => taskDataCache.delete(taskKey(id)));
};

/** API methods that never change task data (reads and UI-only state) */
const NON_TASK_API_METHODS = new Set([
  // reads
  "project",
  "users",
  "user",
  "columns",
  "tabs",
  "tab",
  "userLabelsForProject",
  "tasks",
  "taskHistory",
  "annotations",
  "task",
  "nextTask",
  "annotation",
  "fetchAnnotation",
  "presignUrlForTask",
  "presignUrlForProject",
  "taskDrafts",
  "actions",
  "actionForm",
  "listComments",
  // UI-only writes
  "createTab",
  "updateTab",
  "orderTab",
  "deleteTab",
  "saveUserLabels",
  "setSelectedItems",
  "addSelectedItem",
  "deleteSelectedItem",
]);

/** Writes that affect only the task open in the labeling UI (or the one just left) */
const TASK_SCOPED_API_METHODS = new Set([
  "submitAnnotation",
  "updateAnnotation",
  "deleteAnnotation",
  "updateDraft",
  "deleteDraft",
  "createDraftForAnnotation",
  "createDraftForTask",
  "convertToDraft",
  "createComment",
  "updateComment",
  "deleteComment",
]);

/** Tasks the user recently left; their saves may still be running */
const recentlyLeft = [];
const RECENTLY_LEFT_SIZE = 3;
/** Saves of a task that was just left start within this window after the switch */
const LEAVE_SAVE_WINDOW = 3000;
let lastSwitchAt = 0;

let pendingWrites = 0;
let writesSettledWaiters = [];

const whenWritesSettled = () =>
  pendingWrites === 0 ? Promise.resolve() : new Promise((resolve) => writesSettledWaiters.push(resolve));

const isTaskWrite = (methodName) => !NON_TASK_API_METHODS.has(methodName);

/**
 * Called for every API request, before it is sent. Drops prefetched task data
 * that the write could make stale: the affected task(s) for annotation/draft/
 * comment writes, everything for any other write (bulk actions, etc).
 * Returns a function to call when the request is finished.
 */
export const trackApiCall = (methodName, params, openTaskIDs = []) => {
  if (!isTaskWrite(methodName)) return () => {};

  if (TASK_SCOPED_API_METHODS.has(methodName)) {
    // A write without taskID right after a switch may belong to the task just left
    const leftTasks = !params?.taskID && Date.now() - lastSwitchAt < LEAVE_SAVE_WINDOW ? recentlyLeft : [];
    invalidatePrefetchedTaskData(params?.taskID, ...openTaskIDs, ...leftTasks);
  } else {
    invalidatePrefetchedTaskData();
  }

  pendingWrites++;
  let done = false;

  return () => {
    if (done) return;
    done = true;
    pendingWrites = Math.max(0, pendingWrites - 1);
    if (pendingWrites === 0) {
      const waiters = writesSettledWaiters;
      writesSettledWaiters = [];
      waiters.forEach((resolve) => resolve());
    }
  };
};

/* ------------------------------------------------------------------ */
/* Neighbour prefetch                                                  */
/* ------------------------------------------------------------------ */

/** Neighbouring tasks in the order we want them prefetched (nearest first) */
export const getNeighbourTasks = (list, currentId, { ahead, behind }) => {
  const index = list.findIndex((task) => task.id === currentId);
  if (index === -1) return [];

  const result = [];
  const max = Math.max(ahead, behind);

  for (let step = 1; step <= max; step++) {
    if (step <= ahead && list[index + step]) result.push(list[index + step]);
    if (step <= behind && list[index - step]) result.push(list[index - step]);
  }

  return result;
};

let generation = 0;
let currentTaskId = null;

const prefetchData = (taskStore, taskID) => {
  if (typeof taskStore.prefetchTask !== "function") return;
  try {
    taskStore.prefetchTask(taskID);
  } catch {
    // ignore — the task will be loaded normally
  }
};

/**
 * Prefetch data and images of tasks around `currentTask`.
 *
 * Task data of neighbours is requested right away, except for tasks the user
 * has just left: those are requested only after all pending saves are done,
 * so they come back with the latest annotations/drafts.
 *
 * Images are downloaded one at a time, so the current task's own images
 * (loaded by LSF through the same cache, which allows 4 parallel requests)
 * always get free slots. When the user switches to another task, remaining
 * prefetches of the previous position are dropped.
 */
export const prefetchNeighbourTasks = async (taskStore, currentTask) => {
  const myGeneration = ++generation;
  const settings = getSettings();

  if (!currentTask) return;

  if (currentTaskId !== null && currentTaskId !== currentTask.id) {
    recentlyLeft.unshift(currentTaskId);
    recentlyLeft.splice(RECENTLY_LEFT_SIZE);
    lastSwitchAt = Date.now();
  }
  currentTaskId = currentTask.id;

  // the task being opened is fresh; never serve it from a stale prefetch
  invalidatePrefetchedTaskData(currentTask.id);

  if (!taskStore?.list || settings.ahead + settings.behind === 0) return;

  const neighbours = getNeighbourTasks(taskStore.list, currentTask.id, settings);
  const justLeft = neighbours.filter((task) => recentlyLeft.includes(task.id));

  neighbours.filter((task) => !justLeft.includes(task)).forEach((task) => prefetchData(taskStore, task.id));

  if (justLeft.length) {
    // wait until saves of the left task have started (they begin right after the switch) and finished
    const sinceSwitch = Date.now() - lastSwitchAt;
    new Promise((resolve) => setTimeout(resolve, Math.max(0, LEAVE_SAVE_WINDOW - sinceSwitch)))
      .then(whenWritesSettled)
      .then(() => {
        if (myGeneration !== generation) return;
        justLeft.forEach((task) => prefetchData(taskStore, task.id));
      });
  }

  const urls = [];
  for (const task of neighbours) {
    urls.push(...collectImageUrls(task.data));
  }

  await prefetchImages(urls, myGeneration);
};

/**
 * Download (one at a time) and pre-decode images into the shared image cache.
 * Stops as soon as another prefetch run starts (`generation` changes).
 */
const prefetchImages = async (urls, myGeneration) => {
  for (const url of [...new Set(urls)]) {
    if (myGeneration !== generation) return;

    try {
      // If LSF (or another prefetch) is already loading it, this reuses the pending request
      const cached = imageCache.get(url) ?? (await imageCache.load(url, "anonymous"));
      await predecode(url, cached?.blobUrl);
    } catch {
      // Not an image, no access, network error — the task will just load normally
    }
  }
};

/* ------------------------------------------------------------------ */
/* Label stream                                                        */
/* ------------------------------------------------------------------ */

/**
 * In the label stream the server picks (and locks) the next task, so the client
 * can't know it. The next-task API returns `prefetch_hint`: tasks likely to be
 * served after the current one (same order as sequential / Data Manager queue
 * sampling), without locking them. We only download their images, so when the
 * server serves one of them it is shown instantly.
 */
let labelStreamHint = [];

/** Remember the hint from a next-task response and remove it from the payload */
export const takeLabelStreamHint = (taskData) => {
  if (!taskData || typeof taskData !== "object" || !("prefetch_hint" in taskData)) return taskData;

  const hint = taskData.prefetch_hint;
  labelStreamHint = Array.isArray(hint) ? hint.filter((task) => task && task.data) : [];

  // mutate instead of copying: API responses carry a non-enumerable `$meta` (status etc)
  delete taskData.prefetch_hint;

  return taskData;
};

/** Download images of the tasks hinted by the server for the label stream */
export const prefetchLabelStreamTasks = async (currentTask) => {
  const myGeneration = ++generation;
  const settings = getSettings();

  if (settings.ahead === 0) return;

  const urls = [];
  for (const task of labelStreamHint.slice(0, Math.max(settings.ahead, 1))) {
    if (currentTask && task.id === currentTask.id) continue;
    urls.push(...collectImageUrls(task.data));
  }

  await prefetchImages(urls, myGeneration);
};

/** Stop prefetching (e.g. when the labeling UI is closed) */
export const cancelPrefetch = () => {
  generation++;
  currentTaskId = null;
  labelStreamHint = [];
  recentlyLeft.length = 0;
  decodedImages.clear();
  invalidatePrefetchedTaskData();
};
