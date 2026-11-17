/**
 * Generic display utilities for the calibrated 3D scene.
 * No bones or links are inferred from a predefined pose schema.
 * Bone geometry comes exclusively from the selected source's Relations.
 */
// Colour describes the side of a bone, NOT the skeleton's topology.
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

/**
 * Side from an optional joint-name prefix. Unknown names stay neutral:
 * no fixed HALPE/COCO schema or predeclared set of joints is required.
 */
export const sideOf = (joint) => {
  const name = String(joint ?? "").trim().toLowerCase();
  if (/^(left|l)[_\s-]/.test(name)) return "left";
  if (/^(right|r)[_\s-]/.test(name)) return "right";
  return null;
};

export const colorOf = (joint) =>
  sideOf(joint) === "left" ? LEFT : sideOf(joint) === "right" ? RIGHT : BONE;

/**
 * A neutral/central endpoint inherits the other endpoint's side.
 * A left-right cross-body link and a neutral-neutral link are gray.
 * Both 2D and 3D use this identical rule; Relations alone define edges.
 */
export const boneColorOf = (from, to) => {
  const a = sideOf(from);
  const b = sideOf(to);
  if (a && b && a !== b) return BONE;
  return a === "left" || b === "left" ? LEFT
    : a === "right" || b === "right" ? RIGHT
      : BONE;
};
