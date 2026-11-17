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
export const BONE = "#94A3B8";

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

/**
 * Label Studio stores <Label background="#RRGGBB"> as the keypoint's
 * region.style.fillcolor. Canonicalize hex values for the 3D canvas tint
 * routine, while accepting CSS shorthand and optional alpha.
 */
export const normalizeHexColor = (value) => {
  if (typeof value !== "string") return null;
  const color = value.trim();
  if (/^#[\da-f]{3,4}$/i.test(color)) {
    const full = color.slice(1).split("").map((c) => c + c).join("");
    return "#" + full.slice(0, 6).toUpperCase();
  }
  if (/^#[\da-f]{6}([\da-f]{2})?$/i.test(color)) {
    return color.slice(0, 7).toUpperCase();
  }
  return null;
};

/** Use the actual Label background when present; naming is only fallback. */
export const colorOf = (joint, configuredColor) =>
  normalizeHexColor(configuredColor) ??
  (sideOf(joint) === "left" ? LEFT : sideOf(joint) === "right" ? RIGHT : BONE);

/**
 * For cross-body bones, prefer the most frequent explicitly configured
 * neutral-joint colour over the fallback gray. No named joints are required.
 * Each entry is [jointName, labelBackground].
 */
export const neutralColorOf = (entries = []) => {
  const counts = new Map();
  for (const [joint, value] of entries) {
    if (sideOf(joint)) continue;
    const color = normalizeHexColor(value);
    if (!color) continue;
    counts.set(color, (counts.get(color) ?? 0) + 1);
  }
  let best = BONE, max = 0;
  for (const [color, count] of counts) {
    if (count > max) { best = color; max = count; }
  }
  return best;
};

/**
 * Both 2D and 3D choose bone colours from the two Label backgrounds.
 * Central -> sided: choose the sided endpoint's colour.
 * Opposite sides: use configured neutral colour; identical colours: reuse.
 * This affects appearance only: topology always comes from saved Relations.
 */
export const boneColorOf = (from, to, fromColor, toColor, neutralColor = BONE) => {
  const neutral = normalizeHexColor(neutralColor) ?? BONE;
  const aColor = colorOf(from, fromColor);
  const bColor = colorOf(to, toColor);
  const a = sideOf(from);
  const b = sideOf(to);

  if (a && b && a !== b) return neutral;
  if (aColor.toLowerCase() === bColor.toLowerCase()) return aColor;
  if (a && !b) return aColor;
  if (b && !a) return bColor;
  if (aColor.toLowerCase() === neutral.toLowerCase()) return bColor;
  if (bColor.toLowerCase() === neutral.toLowerCase()) return aColor;
  if (a && b && a === b) return String(from) < String(to) ? aColor : bColor;
  return neutral;
};
