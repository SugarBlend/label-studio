/**
 * Generic display utilities for the calibrated 3D scene.
 * No bones or links are inferred from a predefined pose schema.
 * Bone geometry comes exclusively from the selected source's Relations.
 */
export const LEFT = "#159ee8";
export const RIGHT = "#ed7929";

// Stable per-camera palette used by the camera markers, 3D observation rays
// and 2D epipolar curves. Colour represents the SOURCE camera, not the joint.
export const CAMERA_COLORS = ["#db4b45", "#128e75", "#3e77df", "#a461c5"];
export const cameraColorOf = (slot) => CAMERA_COLORS[slot] ?? "#64748b";
export const BONE = "#475569";

/**
 * Return unique, undirected bone edges ONLY when they are saved as Relations
 * and both 3D endpoints have been reconstructed. No hard-coded exclusions.
 */
export function uniqueRelationEdges(relations = [], presentJoints = new Set()) {
  const unique = new Map();
  for (const edge of relations ?? []) {
    if (!Array.isArray(edge) || edge.length !== 2) continue;
    const [from, to] = edge;
    if (typeof from !== "string" || typeof to !== "string" ||
        !from || !to || from === to ||
        !presentJoints.has(from) || !presentJoints.has(to)) continue;
    const key = [from, to].sort().join("\u0000");
    if (!unique.has(key)) unique.set(key, [from, to]);
  }
  return [...unique.values()];
}

export const sideOf = (joint) => joint.startsWith("l_") ? "l" : joint.startsWith("r_") ? "r" : "";
export const colorOf = (joint) => sideOf(joint) === "l" ? LEFT : sideOf(joint) === "r" ? RIGHT : BONE;
