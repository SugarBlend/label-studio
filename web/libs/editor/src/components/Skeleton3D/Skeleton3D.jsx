import React, { useEffect, useMemo, useRef, useState } from "react";
import { reaction } from "mobx";
import { adaptSkeleton, createReconstructionRunner, readSkeletonSnapshot } from "./adapter";
import { requestReconstruction } from "./request";
import { LEFT, RIGHT, BONE, standardEdges, sideOf, colorOf } from "./topology";

const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scale = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = (a) => { const n = Math.hypot(...a) || 1; return [a[0] / n, a[1] / n, a[2] / n]; };
const validPosition = (p) => Array.isArray(p) && p.length === 3 && p.every(Number.isFinite);

const INK = "#25303f";
const FLOOR = "#dbe2ec";
const FLOOR_MAJOR = "#b9c6d8";
const SHADOW = "#c6cdd9";

const formatAngle = (value) => (Number.isFinite(value) ? `${value >= 0 ? "+" : "−"}${Math.abs(value).toFixed(1)}°` : "n/a");

/** Orbit camera, perspective projection. The floor plane is z = 0 in the calibration frame. */
export function SkeletonView({ data, docked = false }) {
  const [view, setView] = useState({ yaw: -1.15, pitch: 0.34, zoom: 1.25 });
  const drag = useRef(null);
  const svg = useRef(null);
  const W = 640;
  const H = docked ? 700 : 400;

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

  const [layers, setLayers] = useState({ grid: true, shadows: true, soles: true, labels: true });
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
    const y = Math.min(H - 8, sole.center[1] + (sole.side === "l" ? 26 : 46));
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
        {layers.grid && grid.map((line) => (
          <line key={line.key} x1={line.a[0]} y1={line.a[1]} x2={line.b[0]} y2={line.b[1]}
            stroke={line.major ? FLOOR_MAJOR : FLOOR} strokeWidth={line.major ? 1.1 : 0.8} />
        ))}
        {layers.shadows && shadow.map((line) => (
          <line key={line.key} x1={line.a[0]} y1={line.a[1]} x2={line.b[0]} y2={line.b[1]} stroke={SHADOW} strokeWidth={4} strokeLinecap="round" />
        ))}
        {edges.map(([a, b]) => (nodes.has(a) && nodes.has(b)
          ? <line key={`${a}:${b}`} x1={nodes.get(a)[0]} y1={nodes.get(a)[1]} x2={nodes.get(b)[0]} y2={nodes.get(b)[1]}
            stroke={sideOf(a) && sideOf(a) === sideOf(b) ? colorOf(a) : BONE} strokeWidth={4} strokeLinecap="round" />
          : null))}
        {layers.soles && soles.map((sole) => (
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
        {layers.labels && footLabels.map((label) => (
          <g key={`label:${label.side}`}>
            <line x1={label.center[0]} y1={label.center[1]} x2={label.x} y2={label.y - 5} stroke={label.color} strokeWidth={1} />
            <text x={label.x} y={label.y} fontSize="16" fontWeight="600" textAnchor={label.anchor} fill={label.color}>
              {label.text}
            </text>
          </g>
        ))}
        <g fontFamily="system-ui, sans-serif" fill={INK}>
          <text x={14} y={24} fontSize="15">
            {`joints ${joints.length}${meanRms === null ? "" : ` · mean reproj ${meanRms.toFixed(1)} px`}`}
          </text>
          <text x={14} y={46} fontSize="15" fill={LEFT}>{`L forefoot tilt: ${formatAngle(data.foot_tilt?.left)}`}</text>
          <text x={14} y={68} fontSize="15" fill={RIGHT}>{`R forefoot tilt: ${formatAngle(data.foot_tilt?.right)}`}</text>
        </g>
      </svg>
      <div style={{ display: "flex", gap: 6, marginTop: 6, fontSize: 12, flexWrap: "wrap" }}>
        {Object.entries({ grid: "Grid", shadows: "Shadow", soles: "Soles", labels: "Labels" }).map(([key, label]) => (
          <label key={key} style={{ display: "inline-flex", alignItems: "center", gap: 3, marginRight: 6 }}>
            <input type="checkbox" checked={layers[key]} onChange={(event) => setLayers((old) => ({ ...old, [key]: event.target.checked }))} />{label}
          </label>
        ))}
        <button type="button" onClick={() => setView((v) => ({ ...v, yaw: v.yaw - 0.2 }))}>Rotate left</button>
        <button type="button" onClick={() => setView((v) => ({ ...v, yaw: v.yaw + 0.2 }))}>Rotate right</button>
        <button type="button" onClick={() => setView((v) => ({ ...v, zoom: Math.min(5, v.zoom * 1.25) }))}>Zoom in</button>
        <button type="button" onClick={() => setView((v) => ({ ...v, zoom: Math.max(0.4, v.zoom / 1.25) }))}>Zoom out</button>
        <button type="button" onClick={() => setView({ yaw: -1.15, pitch: 0.26, zoom: 1 })}>Reset</button>
      </div>
    </>
  );
}

const PANEL_KEY = "ls.skeleton3d.panel";
const readPanelState = () => {
  try {
    const saved = JSON.parse(window.localStorage.getItem(PANEL_KEY) ?? "{}");
    return {
      collapsed: saved.collapsed === true,
      position: saved.position && Number.isFinite(saved.position.left) && Number.isFinite(saved.position.top) ? saved.position : null,
    };
  } catch (error) {
    return { collapsed: false, position: null };
  }
};

/** Floating read-only window: the 3D view stays visible next to the mosaic while labelling. */
export function Skeleton3D({ store, config, docked = false }) {
  const [state, setState] = useState({ status: "pending", data: null });
  const [panel, setPanel] = useState(readPanelState);
  const box = useRef(null);
  const moving = useRef(null);
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
  useEffect(() => {
    try { window.localStorage.setItem(PANEL_KEY, JSON.stringify(panel)); } catch (error) { /* private mode */ }
  }, [panel]);
  useEffect(() => {
    const keepInside = () => setPanel((current) => {
      if (!current.position) return current;
      const width = box.current?.offsetWidth ?? 420;
      const height = box.current?.offsetHeight ?? 320;
      return {
        ...current,
        position: {
          left: Math.min(current.position.left, Math.max(8, window.innerWidth - width - 8)),
          top: Math.min(current.position.top, Math.max(8, window.innerHeight - height - 8)),
        },
      };
    });
    window.addEventListener("resize", keepInside);
    return () => window.removeEventListener("resize", keepInside);
  }, []);

  const data = state.data;
  const warnings = [
    ...(state.notes ?? []),
    ...(data?.warnings ?? []).map((w) => (typeof w === "string" ? w : JSON.stringify(w))),
    ...(data?.rejected ?? []).map((r) => `${r.joint}: ${r.reason}`),
  ];
  const status = state.status === "pending" ? "reconstructing…" : state.status === "ready" ? "drag to orbit · wheel to zoom" : "";
  const angles = data ? `L ${formatAngle(data.foot_tilt?.left)} · R ${formatAngle(data.foot_tilt?.right)}` : "";
  return (
    <section ref={box} aria-label="Live 3D skeleton"
      style={{
        ...(docked ? {
          position: "relative", width: "100%", minHeight: "100%", maxHeight: "none", border: "none", borderRadius: 0, boxShadow: "none",
        } : {
          position: "fixed", zIndex: 1200, width: "min(440px, 92vw)", maxHeight: "80vh",
          border: "1px solid #cbd5e1", borderRadius: 8, boxShadow: "0 10px 28px rgba(15, 23, 42, 0.18)",
          ...(panel.position ? { left: panel.position.left, top: panel.position.top } : { right: 16, bottom: 16 }),
        }),
        display: "flex", flexDirection: "column", background: "#ffffff",
      }}>
      <header
        style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 8px", cursor: "grab", userSelect: "none", borderBottom: panel.collapsed ? "none" : "1px solid #e2e8f0" }}
        onPointerDown={(event) => {
          if (docked || event.target.closest("button")) return;
          const rect = box.current?.getBoundingClientRect();
          if (!rect) return;
          moving.current = { dx: event.clientX - rect.left, dy: event.clientY - rect.top };
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={(event) => {
          if (!moving.current) return;
          const width = box.current?.offsetWidth ?? 420;
          const height = box.current?.offsetHeight ?? 320;
          setPanel((current) => ({
            ...current,
            position: {
              left: Math.min(Math.max(8, event.clientX - moving.current.dx), Math.max(8, window.innerWidth - width - 8)),
              top: Math.min(Math.max(8, event.clientY - moving.current.dy), Math.max(8, window.innerHeight - height - 8)),
            },
          }));
        }}
        onPointerUp={() => { moving.current = null; }}
        onPointerCancel={() => { moving.current = null; }}>
        <strong style={{ fontSize: 13 }}>3D skeleton</strong>
        <span style={{ fontSize: 11, color: "#64748b", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {panel.collapsed ? angles : status}
        </span>
        {warnings.length > 0 && <span title="Warnings" style={{ fontSize: 11, color: "#b45309" }}>⚠{warnings.length}</span>}
        <span style={{ flex: 1 }} />
        {!docked && <button type="button" aria-expanded={!panel.collapsed} title={panel.collapsed ? "Expand" : "Collapse"}
          onClick={() => setPanel((current) => ({ ...current, collapsed: !current.collapsed }))}
          style={{ border: "none", background: "transparent", cursor: "pointer", fontSize: 14, lineHeight: 1, padding: "2px 6px" }}>
          {panel.collapsed ? "▢" : "–"}
        </button>}
      </header>
      {(docked || !panel.collapsed) && (
        <div style={{ padding: "8px 10px 10px", overflow: "auto" }}>
          <div role="status" aria-live="polite" style={{ fontSize: 12, color: "#b91c1c" }}>{state.error}</div>
          {data && <SkeletonView data={data} docked={docked} />}
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
        </div>
      )}
    </section>
  );
}
