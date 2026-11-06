/**
 * Keep a valid 3D scene visible during frame transitions without pretending
 * that it belongs to the incoming frame. Pure helper; no browser storage.
 */
export function mergeFrameState(previous, next) {
  if (previous?.data && (next.status === "pending" || next.status === "invalid" || next.status === "error")) {
    return { ...next, data: previous.data, stale: true };
  }
  if (previous?.data && next.status === "ready" && !next.data?.joints?.length) {
    return {
      ...next,
      data: previous.data,
      stale: true,
      error: "No reconstructable joints in the current frame.",
    };
  }
  return { ...next, stale: false };
}
