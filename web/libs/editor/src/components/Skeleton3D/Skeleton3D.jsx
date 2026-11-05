import React, { useEffect, useRef, useState } from "react";
import { reaction } from "mobx";
import { adaptSkeleton, createReconstructionRunner, readSkeletonSnapshot } from "./adapter";
import { requestReconstruction } from "./request";

const dot = (a, b) => a.reduce((sum, v, i) => sum + v * b[i], 0);
const cross = (a, b) => [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]];
const unit = (a) => a.map((v) => v / Math.hypot(...a));
const validPosition = (p) => Array.isArray(p) && p.length === 3 && p.every(Number.isFinite);
const standardEdges = [
  ["l_shoulder", "r_shoulder"], ["l_hip", "r_hip"],
  ...["l", "r"].flatMap((s) => [
    [`${s}_shoulder`, `${s}_elbow`], [`${s}_elbow`, `${s}_wrist`],
    [`${s}_shoulder`, `${s}_hip`], [`${s}_hip`, `${s}_knee`], [`${s}_knee`, `${s}_ankle`],
    [`${s}_ankle`, `${s}_heel`], [`${s}_heel`, `${s}_big_toe`],
    [`${s}_heel`, `${s}_small_toe`], [`${s}_big_toe`, `${s}_small_toe`],
  ]),
];

/** Orthographic 3D projection: floor is through world origin, normal floor_up. */
function SkeletonView({ data }) {
  const [angle, setAngle] = useState({ yaw: 0.6, pitch: 0.45 });
  const [zoom, setZoom] = useState(1);
  const drag = useRef(null);
  const joints = data.joints.filter((j) => validPosition(j.position));
  const up = validPosition(data.floor_up) && Math.hypot(...data.floor_up) > 0 ? unit(data.floor_up) : [0, 0, 1];
  const right = unit(cross(Math.abs(up[2]) < 0.9 ? [0, 0, 1] : [0, 1, 0], up));
  const forward = cross(up, right);
  const world = (p) => [dot(p, right), dot(p, forward), dot(p, up)];
  const positions = joints.map((j) => world(j.position));
  const center = [0, 1, 2].map((i) => positions.length ? positions.reduce((s, p) => s + p[i], 0) / positions.length : 0);
  const radius = Math.max(0.001, ...positions.map((p) => Math.hypot(...p.map((v, i) => v - center[i]))));
  const rotate = (p) => {
    const [x, y, z] = p.map((v, i) => v - center[i]);
    const depth = x * Math.sin(angle.yaw) + y * Math.cos(angle.yaw);
    return [x * Math.cos(angle.yaw) - y * Math.sin(angle.yaw), z * Math.cos(angle.pitch) - depth * Math.sin(angle.pitch)];
  };
  const floor = [];
  for (let i = -4; i <= 4; i++) {
    const offset = i * radius / 3;
    floor.push([[center[0] + offset, center[1] - radius * 1.4, 0], [center[0] + offset, center[1] + radius * 1.4, 0]]);
    floor.push([[center[0] - radius * 1.4, center[1] + offset, 0], [center[0] + radius * 1.4, center[1] + offset, 0]]);
  }
  const extent = Math.max(radius, ...floor.flat().map((p) => Math.max(...rotate(p).map(Math.abs))));
  const project = (p) => { const [x, y] = rotate(p); return [240 + x * 135 * zoom / extent, 155 - y * 135 * zoom / extent]; };
  const nodes = new Map(joints.map((j, i) => [j.joint, project(positions[i])]));
  const edges = new Map([...(data.edges ?? []), ...standardEdges].map((edge) => [edge.slice().sort().join(":"), edge]));
  const line = (a, b, key, color, width) => <line key={key} x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]} stroke={color} strokeWidth={width} />;
  return (
    <>
      <svg viewBox="0 0 480 310" role="img" aria-label="Read-only reconstructed skeleton. Drag to rotate."
        style={{ width: "100%", maxHeight: 340, background: "#f5f7fa", touchAction: "none", cursor: "grab" }}
        onPointerDown={(e) => { drag.current = [e.clientX, e.clientY]; e.currentTarget.setPointerCapture(e.pointerId); }}
        onPointerMove={(e) => {
          if (!drag.current) return;
          const [x, y] = drag.current;
          setAngle((a) => ({ yaw: a.yaw + (e.clientX - x) * 0.01, pitch: Math.max(-1.4, Math.min(1.4, a.pitch + (e.clientY - y) * 0.01)) }));
          drag.current = [e.clientX, e.clientY];
        }} onPointerUp={() => { drag.current = null; }} onPointerCancel={() => { drag.current = null; }}>
        <title>Reconstructed skeleton and world-origin floor</title>
        {floor.map(([a, b], i) => line(project(a), project(b), `floor-${i}`, "#cbd5e1", 1))}
        {[...edges].map(([key, [a, b]]) => nodes.has(a) && nodes.has(b) ? line(nodes.get(a), nodes.get(b), key, "#475569", 2) : null)}
        {joints.map((j) => {
          const p = nodes.get(j.joint);
          return <g key={j.joint}><circle cx={p[0]} cy={p[1]} r="4" fill={j.joint.startsWith("l_") ? "#2563eb" : "#d97706"} />
            <text x={p[0] + 6} y={p[1] - 5} fontSize="9" fill="#334155">{j.joint}</text></g>;
        })}
      </svg>
      <div>
        <button type="button" onClick={() => setAngle((a) => ({ ...a, yaw: a.yaw - 0.2 }))}>Rotate left</button>{" "}
        <button type="button" onClick={() => setAngle((a) => ({ ...a, yaw: a.yaw + 0.2 }))}>Rotate right</button>{" "}
        <button type="button" disabled={zoom >= 4} onClick={() => setZoom((z) => Math.min(4, z * 1.25))}>Zoom in</button>{" "}
        <button type="button" disabled={zoom <= 0.5} onClick={() => setZoom((z) => Math.max(0.5, z / 1.25))}>Zoom out</button>{" "}
        <button type="button" onClick={() => { setAngle({ yaw: 0.6, pitch: 0.45 }); setZoom(1); }}>Reset view</button>
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
    ...(data?.warnings ?? []).map((w) => typeof w === "string" ? w : JSON.stringify(w)),
    ...(data?.rejected ?? []).map((r) => `${r.joint}: ${r.reason}`),
  ];
  return (
    <section aria-label="Live 3D skeleton" style={{ padding: 16, border: "1px solid #cbd5e1", borderRadius: 6 }}>
      <h3>Live 3D skeleton · read-only</h3>
      <p>Drag to rotate. Floor passes through the calibration origin. Changes are not saved by this preview.</p>
      <div role="status" aria-live="polite">
        {state.status === "pending" && "Reconstructing…"}
        {state.error && <p>{state.error}</p>}
      </div>
      {data && <>
        <SkeletonView data={data} />
        <p>{["left", "right"].map((side) => `${side === "left" ? "Left" : "Right"} foot_tilt: ${Number.isFinite(data.foot_tilt?.[side]) ? `${data.foot_tilt[side].toFixed(1)}°` : "unavailable (need valid heel, big toe and small toe)"}`).join(" · ")}</p>
        <p>Geometric angle, not a clinical assessment. Positive means the big toe is higher.</p>
        {warnings.length > 0 && <div role="status"><strong>Warnings</strong><ul>{warnings.map((warning, i) => <li key={`${i}:${warning}`}>{warning}</li>)}</ul></div>}
        <details><summary>Reconstruction quality ({data.joints.length} joints)</summary>
          <ul>{data.joints.map((j) => <li key={j.joint}>{j.joint}: views {(j.views ?? []).join(", ")}; RMS {Number.isFinite(j.rms_reprojection_error_px) ? j.rms_reprojection_error_px.toFixed(2) : "—"} px
            {(j.reprojection_errors ?? []).map((e) => `; slot ${e.slot}: ${Number.isFinite(e.error_px) ? e.error_px.toFixed(2) : "—"} px`).join("")}</li>)}</ul>
        </details>
      </>}
    </section>
  );
}
