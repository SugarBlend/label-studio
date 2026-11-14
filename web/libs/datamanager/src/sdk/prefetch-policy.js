/**
 * Conservative defaults for multi-annotator projects: one forward and one
 * backward image, no speculative task/annotation payloads. A fresh task GET
 * on navigation avoids showing another annotator's now-stale changes.
 */
export const PREFETCH_LIMITS = Object.freeze({
  ahead: 2, behind: 1, imagesPerSwitch: 2,
});

const boundedCount = (value, fallback, max) => (
  Number.isFinite(value) ? Math.min(max, Math.max(0, Math.floor(value))) : fallback
);

export function getPrefetchPolicy(raw) {
  let settings;
  try {
    settings = typeof raw === "string" ? JSON.parse(raw) : raw;
  } catch {
    settings = null;
  }
  return {
    ahead: boundedCount(settings?.ahead, 1, PREFETCH_LIMITS.ahead),
    behind: boundedCount(settings?.behind, 1, PREFETCH_LIMITS.behind),
    instant: typeof settings?.instant === "boolean" ? settings.instant : true,
    // Opt-in only: task JSON contains mutable annotations/drafts, which can
    // become stale while colleagues annotate the same project.
    taskData: settings?.taskData === true,
  };
}

export const limitPrefetchUrls = (urls) =>
  [...new Set(urls)].slice(0, PREFETCH_LIMITS.imagesPerSwitch);
