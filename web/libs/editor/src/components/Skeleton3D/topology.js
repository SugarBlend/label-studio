/**
 * Shared HALPE-26-style body topology used by the live 3D scene and the
 * read-only 2D camera overlays. Edges are only drawn when both endpoints exist.
 * The underlying Label Studio regions and Relations are never modified.
 */
export const LEFT = "#159ee8";
export const RIGHT = "#ed7929";
export const BONE = "#475569";

export const standardEdges = [
  ["l_shoulder", "r_shoulder"],
  ["l_hip", "r_hip"],
  ["neck", "l_shoulder"],
  ["neck", "r_shoulder"],
  ["neck", "head"],
  ["head", "nose"],
  ["nose", "l_eye"],
  ["nose", "r_eye"],
  ["l_eye", "l_ear"],
  ["r_eye", "r_ear"],
  ["hip", "l_hip"],
  ["hip", "r_hip"],
  ...["l", "r"].flatMap((side) => [
    [`${side}_shoulder`, `${side}_elbow`],
    [`${side}_elbow`, `${side}_wrist`],
    [`${side}_shoulder`, `${side}_hip`],
    [`${side}_hip`, `${side}_knee`],
    [`${side}_knee`, `${side}_ankle`],
    [`${side}_ankle`, `${side}_heel`],
    [`${side}_ankle`, `${side}_big_toe`],
    [`${side}_ankle`, `${side}_small_toe`],
    [`${side}_heel`, `${side}_big_toe`],
    [`${side}_heel`, `${side}_small_toe`],
    [`${side}_big_toe`, `${side}_small_toe`],
  ]),
];

export const sideOf = (joint) => joint.startsWith("l_") ? "l" : joint.startsWith("r_") ? "r" : "";
export const colorOf = (joint) => sideOf(joint) === "l" ? LEFT : sideOf(joint) === "r" ? RIGHT : BONE;
