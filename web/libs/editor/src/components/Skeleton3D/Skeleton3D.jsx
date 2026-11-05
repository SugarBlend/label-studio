import React, { useEffect, useMemo, useRef, useState } from "react";
import { reaction } from "mobx";
import { adaptSkeleton, createReconstructionRunner, readSkeletonSnapshot } from "./adapter";
import { requestReconstruction } from "./request";

const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scale = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = (a) => { const n = Math.hypot(...a) || 1; return [a[0] / n, a[1] / n, a[2] / n]; };
const validPosition = (p) => Array.isArray(p) && p.length === 3 && p.every(Number.isFinite);

const LEFT = "#2f6fd0";
const RIGHT = "#df7a1c";
const BONE = "#3b4657";
const INK = "#25303f";
const FLOOR = "#dbe2ec";
const FLOOR_MAJOR = "#b9c6d8";
const SHADOW = "#c6cdd9";

const standardEdges = [
  ["l_shoulder", "r_shoulder"], ["l_hip", "r_hip"],
  ...["l", "r"].flatMap((s) => [
    [`${s}_shoulder`, `${s}_elbow`], [`${s}_elbow`, `${s}_wrist`],
    [`${s}_shoulder`, `${s}_hip`], [`${s}_hip`, `${s}_knee`], [`${s}_knee`, `${s}_ankle`],
    [`${s}_ankle`, `${s}_heel`], [`${s}_heel`, `${s}_big_toe`],
    [`${s}_heel`, `${s}_small_toe`], [`${s}_big_toe`, `${s}_small_toe`],
  ]),
];

const sideOf = (joint) => (joint.startsWith("l_") ? "l" : joint.startsWith("r_") ? "r" : "");
const colorOf = (joint) => (sideOf(joint) === "l" ? LEFT : sideOf(joint) === "r" ? RIGHT : BONE);
const formatAngle = (value) => (Number.isFinite(value) ? `${value >= 0 ? "+" : "−"}${Math.abs(value).toFixed(1)}°` : "n/a");

/** Orbit camera, perspective projection. The floor plane is z = 0 in the calibration frame. */
export function SkeletonView({ data }) {
  const [view, setView] = useState({ yaw: -1.15, pitch: 0.34, zoom: 1.25 });
  const drag = useRef(null);
  const svg = useRef(null);
  const W = 720;
  const H = 430;

  useEffect(() => {
    const el = svg.current;
    if (!el) return undefined;
    const onWheel = (event) => {
      event.preventDefault();
      setView((v) => ({ ...v, zoom: Math.min(5, Math.max(0.4, v.zoom * (event.deltaY > 0 ? 0.88 : 1.14))) }));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  const { joints, edges } = useMemo(() => {
    const unique = new Map([...standardEdges, ...(data.edges ?? [])].map((e) => [e.slice().sort().join("|"), e]));
    return { joints: data.joints.filter((j) => validPosition(j.position)), edges: [...unique.values()] };
  }, [data]);

  const up = validPosition(data.floor_up) && Math.hypot(...data.floor_up) > 0 ? unit(data.floor_up) : [0, 0, 1];
  const axisRight = unit(cross(Math.abs(up[2]) < 0.9 ? [0, 0, 1] : [0, 1, 0], up));
  const axisForward = cross(up, axisRight);
  const world = (p) => [dot(p, axisRight), dot(p, axisForward), dot(p, up)];
  const positions = joints.map((j) => world(j.position));
  const target = positions.length ? scale(positions.reduce(add, [0, 0, 0]), 1 / positions.length) : [0, 0, 1];
  const radius = Math.max(0.2, ...positions.map((p) => Math.hypot(...sub(p, target))));

  const direction = [Math.cos(view.pitch) * Math.cos(view.yaw), Math.cos(view.pitch) * Math.sin(view.yaw), Math.sin(view.pitch)];
  const distance = 3.1 * radius;
  const eye = add(target, scale(direction, distance));
  const forward = unit(sub(target, eye));
  const camRight = unit(cross(forward, up));
  const camUp = cross(camRight, forward);
  const focal = 1.35 * Math.min(W, H);
  const arrow = (p) => {
    const d = sub(p, eye);
    const z = Math.max(0.22 * distance, dot(d, forward));
    const k = focal / z;
    return [dot(d, camRight) * k, -dot(d, camUp) * k];
  };
  // Fit the model into the canvas without clipping, then apply the user zoom around the centre.
  const screen = positions.map(arrow);
  const xs = screen.map((p) => p[0]);
  const ys = screen.map((p) => p[1]);
  const minX = xs.length ? Math.min(...xs) : -1;
  const maxX = xs.length ? Math.max(...xs) : 1;
  const minY = ys.length ? Math.min(...ys) : -1;
  const maxY = ys.length ? Math.max(...ys) : 1;
  const fit = Math.min((W - 80) / Math.max(40, maxX - minX), (H - 108) / Math.max(40, maxY - minY));
  const project = (p) => {
    const q = arrow(p);
    return [
      W / 2 + (q[0] - (minX + maxX) / 2) * fit * view.zoom,
      H / 2 + 6 + (q[1] - (minY + maxY) / 2) * fit * view.zoom,
    ];
  };

  const step = radius > 1.1 ? 0.5 : 0.25;
  const grid = [];
  for (let i = -6; i <= 6; i++) {
    const along = i * step;
    const major = i % 4 === 0;
    grid.push({ key: `gx${i}`, major, a: project([target[0] - 6 * step, target[1] + along, 0]), b: project([target[0] + 6 * step, target[1] + along, 0]) });
    grid.push({ key: `gy${i}`, major, a: project([target[0] + along, target[1] - 6 * step, 0]), b: project([target[0] + along, target[1] + 6 * step, 0]) });
  }

  const nodes = new Map(joints.map((j, i) => [j.joint, project(positions[i])]));
  const jointsByName = new Map(joints.map((j, i) => [j.joint, positions[i]]));
  const shadow = edges.filter(([a, b]) => jointsByName.has(a) && jointsByName.has(b)).map(([a, b]) => {
    const pa = jointsByName.get(a);
    const pb = jointsByName.get(b);
    return { key: `shadow:${a}:${b}`, a: project([pa[0], pa[1], 0]), b: project([pb[0], pb[1], 0]) };
  });

  const soles = ["l", "r"].map((side) => {
    const triple = ["heel", "big_toe", "small_toe"].map((part) => jointsByName.get(`${side}_${part}`));
    if (triple.some((p) => !p)) return null;
    return { side, points: triple.map((p) => project(p).join(",")).join(" "), center: project(scale(triple.reduce(add, [0, 0, 0]), 1 / 3)) };
  }).filter(Boolean);
  const footLabels = soles.map((sole) => {
    const other = soles.find((s) => s.side !== sole.side);
    const fallback = sole.side === "l" ? -1 : 1;
    const outward = other ? Math.sign(sole.center[0] - other.center[0]) || fallback : fallback;
    let anchor = outward < 0 ? "end" : "start";
    let x = sole.center[0] + outward * 15;
    if (anchor === "start" && x > W - 210) { anchor = "end"; x = sole.center[0] - 15; }
    if (anchor === "end" && x < 210) { anchor = "start"; x = sole.center[0] + 15; }
    const y = Math.min(H - 10, sole.center[1] + (sole.side === "l" ? 24 : 42));
    return {
      ...sole, anchor, x, y,
      color: sole.side === "l" ? LEFT : RIGHT,
      text: `${sole.side === "l" ? "L" : "R"} forefoot tilt: ${formatAngle(data.foot_tilt?.[sole.side === "l" ? "left" : "right"])}`,
    };
  });

  const rms = joints.map((j) => j.rms_reprojection_error_px).filter((v) => Number.isFinite(v));
  const meanRms = rms.length ? rms.reduce((s, v) => s + v, 0) / rms.length : null;

  return (
    <>
      <svg ref={svg} viewBox={`0 0 ${W} ${H}`} role="img"
        aria-label="Reconstructed skeleton in 3D. Drag to orbit, wheel to zoom, double click to reset."
        style={{ width: "100%", display: "block", background: "#f6f8fb", borderRadius: 4, touchAction: "none", cursor: drag.current ? "grabbing" : "grab" }}
        onPointerDown={(event) => {
          drag.current = [event.clientX, event.clientY];
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={(event) => {
          if (!drag.current) return;
          const [x, y] = drag.current;
          setView((v) => ({
            ...v,
            yaw: v.yaw - (event.clientX - x) * 0.008,
            pitch: Math.max(-0.15, Math.min(1.25, v.pitch + (event.clientY - y) * 0.006)),
          }));
          drag.current = [event.clientX, event.clientY];
        }}
        onPointerUp={() => { drag.current = null; }}
        onPointerCancel={() => { drag.current = null; }}
        onDoubleClick={() => setView({ yaw: -1.15, pitch: 0.26, zoom: 1 })}>
        <title>Reconstructed skeleton, floor grid and foot angles</title>
        {grid.map((line) => (
          <line key={line.key} x1={line.a[0]} y1={line.a[1]} x2={line.b[0]} y2={line.b[1]}
            stroke={line.major ? FLOOR_MAJOR : FLOOR} strokeWidth={line.major ? 1.1 : 0.8} />
        ))}
        {shadow.map((line) => (
          <line key={line.key} x1={line.a[0]} y1={line.a[1]} x2={line.b[0]} y2={line.b[1]} stroke={SHADOW} strokeWidth={4} strokeLinecap="round" />
        ))}
        {edges.map(([a, b]) => (nodes.has(a) && nodes.has(b)
          ? <line key={`${a}:${b}`} x1={nodes.get(a)[0]} y1={nodes.get(a)[1]} x2={nodes.get(b)[0]} y2={nodes.get(b)[1]}
            stroke={sideOf(a) && sideOf(a) === sideOf(b) ? colorOf(a) : BONE} strokeWidth={4} strokeLinecap="round" />
          : null))}
        {soles.map((sole) => (
          <polygon key={sole.side} points={sole.points} fill={sole.side === "l" ? LEFT : RIGHT} fillOpacity={0.22}
            stroke={sole.side === "l" ? LEFT : RIGHT} strokeWidth={1.2} />
        ))}
        {joints.map((j) => {
          const p = nodes.get(j.joint);
          const color = colorOf(j.joint);
          return (
            <g key={j.joint}>
              <title>{`${j.joint}: views ${(j.views ?? []).join(", ") || "—"}`}</title>
              <circle cx={p[0]} cy={p[1]} r={4.2} fill={color} stroke="#ffffff" strokeWidth={1.4} />
            </g>
          );
        })}
        {footLabels.map((label) => (
          <g key={`label:${label.side}`}>
            <line x1={label.center[0]} y1={label.center[1]} x2={label.x} y2={label.y - 5} stroke={label.color} strokeWidth={1} />
            <text x={label.x} y={label.y} fontSize="14" fontWeight="600" textAnchor={label.anchor} fill={label.color}>
              {label.text}
            </text>
          </g>
        ))}
        <g fontFamily="system-ui, sans-serif" fill={INK}>
          <text x={14} y={22} fontSize="13">
            {`joints ${joints.length}${meanRms === null ? "" : ` · mean reproj ${meanRms.toFixed(1)} px`}`}
          </text>
          <text x={14} y={42} fontSize="13" fill={LEFT}>{`L forefoot tilt: ${formatAngle(data.foot_tilt?.left)}`}</text>
          <text x={14} y={60} fontSize="13" fill={RIGHT}>{`R forefoot tilt: ${formatAngle(data.foot_tilt?.right)}`}</text>
        </g>
      </svg>
      <div style={{ display: "flex", gap: 6, marginTop: 6, fontSize: 12 }}>
        <button type="button" onClick={() => setView((v) => ({ ...v, yaw: v.yaw - 0.2 }))}>Rotate left</button>
        <button type="button" onClick={() => setView((v) => ({ ...v, yaw: v.yaw + 0.2 }))}>Rotate right</button>
        <button type="button" onClick={() => setView((v) => ({ ...v, zoom: Math.min(5, v.zoom * 1.25) }))}>Zoom in</button>
        <button type="button" onClick={() => setView((v) => ({ ...v, zoom: Math.max(0.4, v.zoom / 1.25) }))}>Zoom out</button>
        <button type="button" onClick={() => setView({ yaw: -1.15, pitch: 0.26, zoom: 1 })}>Reset</button>
      </div>
    </>
  );
}

export function Skeleton3D({ store, config }) {
  const [state, setState] = useState({ status: "pending", data: null });
  // Snapshot the full calibration: changing it invalidates an in-flight response.
  const configKey = JSON.stringify(config);
  useEffect(() => {
    const settings = JSON.parse(configKey);
    const runner = createReconstructionRunner({ request: requestReconstruction, onState: setState });
    const dispose = reaction(
      () => JSON.stringify(readSkeletonSnapshot(store)),
      (snapshot) => runner.update({ ...adaptSkeleton(JSON.parse(snapshot), settings), config: settings }),
      { fireImmediately: true },
    );
    return () => { dispose(); runner.dispose(); };
  }, [store, configKey]);
  const data = state.data;
  const warnings = [
    ...(state.notes ?? []),
    ...(data?.warnings ?? []).map((w) => (typeof w === "string" ? w : JSON.stringify(w))),
    ...(data?.rejected ?? []).map((r) => `${r.joint}: ${r.reason}`),
  ];
  return (
    <section aria-label="Live 3D skeleton"
      style={{ padding: 12, border: "1px solid #cbd5e1", borderRadius: 6, background: "#ffffff" }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8 }}>
        <h3 style={{ margin: "0 0 6px", fontSize: 14 }}>Live 3D skeleton · read-only</h3>
        <span style={{ fontSize: 11, color: "#64748b" }}>{state.status === "pending" ? "reconstructing…" : state.status === "ready" ? "drag to orbit · wheel to zoom" : ""}</span>
      </div>
      <div role="status" aria-live="polite" style={{ fontSize: 12, color: "#b91c1c" }}>{state.error}</div>
      {data && <SkeletonView data={data} />}
      {!data && <p style={{ fontSize: 12, color: "#475569" }}>Waiting for keypoints in at least two camera slots.</p>}
      <p style={{ fontSize: 11, color: "#64748b", margin: "6px 0 0" }}>
        Triangulation only, no fitting. Geometric angle, not a clinical assessment; positive means the big toe is higher.
      </p>
      {warnings.length > 0 && (
        <details style={{ fontSize: 12 }}><summary>Warnings ({warnings.length})</summary>
          <ul>{warnings.map((warning, i) => <li key={`${i}:${warning}`}>{warning}</li>)}</ul>
        </details>
      )}
      {data && (
        <details style={{ fontSize: 12 }}><summary>Reconstruction quality ({data.joints.length} joints)</summary>
          <ul>{data.joints.map((j) => (
            <li key={j.joint}>{j.joint}: views {(j.views ?? []).join(", ")}; RMS {Number.isFinite(j.rms_reprojection_error_px) ? j.rms_reprojection_error_px.toFixed(2) : "—"} px
              {(j.reprojection_errors ?? []).map((e) => `; slot ${e.slot}: ${Number.isFinite(e.error_px) ? e.error_px.toFixed(2) : "—"} px`).join("")}
            </li>
          ))}</ul>
        </details>
      )}
    </section>
  );
}
