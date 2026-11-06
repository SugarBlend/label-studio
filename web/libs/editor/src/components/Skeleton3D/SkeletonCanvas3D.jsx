import React, { useEffect, useRef, useState } from "react";
import { BONE, LEFT, RIGHT, colorOf, sideOf, standardEdges } from "./topology";

const add = (a, b) => a.map((n, i) => n + b[i]);
const sub = (a, b) => a.map((n, i) => n - b[i]);
const mul = (a, n) => a.map((x) => x * n);
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = (a) => mul(a, 1 / (Math.hypot(...a) || 1));
const finite = (p) => Array.isArray(p) && p.length === 3 && p.every(Number.isFinite);
const initialView = () => ({ yaw: -1.1, pitch: 0.23, zoom: 1, pan: [0, 0] });

function cameraCentre(calibration) {
  const extr = calibration?.extrinsics;
  if (extr?.T) {
    const t = extr.T.flat(Infinity);
    return finite(t) ? t : null;
  }
  const R = calibration?.R;
  const t = calibration?.t?.flat(Infinity);
  if (Array.isArray(R) && Array.isArray(t) && t.length === 3) {
    return [0, 1, 2].map((col) => -R.reduce((sum, row, i) => sum + row[col] * t[i], 0));
  }
  return null;
}

function tint(hex, factor) {
  const c = hex.replace("#", "");
  const rgb = [0, 2, 4].map((i) => parseInt(c.slice(i, i + 2), 16));
  return "#" + rgb.map((value) => Math.min(255, Math.max(0, Math.round(value * factor))).toString(16).padStart(2, "0")).join("");
}

function draw3D(canvas, data, config, view, options, history, selectedJoint) {
  if (!canvas) return;
  const bounds = canvas.getBoundingClientRect();
  const w = Math.max(1, bounds.width);
  const h = Math.max(1, bounds.height);
  // Use the destination window's DPI when the canvas is on another monitor.
  const dpr = Math.min(2, canvas.ownerDocument?.defaultView?.devicePixelRatio || 1);
  // Updating these attributes clears the canvas; do it only when the actual
  // pixel size changes, not on every reconstructed joint update.
  const pixelWidth = Math.round(w * dpr);
  const pixelHeight = Math.round(h * dpr);
  if (canvas.width !== pixelWidth) canvas.width = pixelWidth;
  if (canvas.height !== pixelHeight) canvas.height = pixelHeight;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  const background = ctx.createLinearGradient(0, 0, 0, h);
  background.addColorStop(0, "#f7f9fd");
  background.addColorStop(1, "#edf1f7");
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, w, h);

  const joints = (data.joints || []).filter((j) => finite(j.position));
  if (!joints.length) return;
  const up = unit(finite(data.floor_up) ? data.floor_up : [0, 0, 1]);
  const axisX = unit(cross(Math.abs(up[2]) > 0.9 ? [0, 1, 0] : [0, 0, 1], up));
  const axisY = unit(cross(up, axisX));
  const world = (p) => [dot(p, axisX), dot(p, axisY), dot(p, up)];
  const points = new Map(joints.map((j) => [j.joint, world(j.position)]));
  const values = [...points.values()];
  const center = mul(values.reduce(add, [0, 0, 0]), 1 / values.length);
  const radius = Math.max(1, ...values.map((p) => Math.hypot(...sub(p, center))));
  const minZ = Math.min(...values.map((p) => p[2]));
  const maxZ = Math.max(...values.map((p) => p[2]));
  const extent = Math.max(1, maxZ - minZ);
  const direction = [Math.cos(view.pitch) * Math.cos(view.yaw), Math.cos(view.pitch) * Math.sin(view.yaw), Math.sin(view.pitch)];
  const distance = radius * 3.3;
  const eye = add(center, mul(direction, distance));
  const forward = unit(sub(center, eye));
  const right = unit(cross(forward, [0, 0, 1]));
  const cameraUp = unit(cross(right, forward));
  const lens = Math.min(w * 1.4, h * 1.27) * view.zoom;
  const project = (p) => {
    const q = sub(p, eye);
    const depth = dot(q, forward);
    const magnification = lens / Math.max(radius * 0.12, depth);
    return {
      x: w / 2 + dot(q, right) * magnification + view.pan[0],
      y: h / 2 - dot(q, cameraUp) * magnification + view.pan[1],
      depth,
      magnification,
    };
  };
  const projected = new Map([...points].map(([name, p]) => [name, project(p)]));
  const pt = (p) => project(p);
  const line = (a, b, color, thickness, alpha = 1) => {
    if (![a.x, a.y, b.x, b.y].every(Number.isFinite)) return;
    ctx.globalAlpha = alpha;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.strokeStyle = color;
    ctx.lineWidth = thickness;
    ctx.lineCap = "round";
    ctx.stroke();
    ctx.globalAlpha = 1;
  };

  // Floor is the calibration plane, not an arbitrary image-bottom baseline.
  const step = Math.pow(10, Math.floor(Math.log10(Math.max(0.2, extent / 8))));
  const gridStep = (extent / step > 20) ? 5 * step : (extent / step > 9) ? 2 * step : step;
  const floorCenter = [center[0], center[1], 0];
  const gridCount = 10;
  if (options.grid) {
    for (let i = -gridCount; i <= gridCount; i++) {
      const offset = i * gridStep;
      const major = i % 5 === 0;
      const color = major ? "#c2ccda" : "#dbe1e9";
      line(pt([floorCenter[0] - gridCount * gridStep, floorCenter[1] + offset, 0]),
        pt([floorCenter[0] + gridCount * gridStep, floorCenter[1] + offset, 0]), color, major ? 1.1 : 0.7);
      line(pt([floorCenter[0] + offset, floorCenter[1] - gridCount * gridStep, 0]),
        pt([floorCenter[0] + offset, floorCenter[1] + gridCount * gridStep, 0]), color, major ? 1.1 : 0.7);
    }
  }

  const links = new Map([...standardEdges, ...(data.edges || [])].map((edge) => [[...edge].sort().join(":"), edge]));
  // Do not reintroduce neck-to-central-hip from manually authored Relations.
  const edges = [...links.values()].filter(([a, b]) =>
    projected.has(a) && projected.has(b) && !((a === "neck" && b === "hip") || (a === "hip" && b === "neck")));

  // Contact shadows share the same ground plane as the grid.
  if (options.shadow) {
    for (const [a, b] of edges) {
      const pa = points.get(a), pb = points.get(b);
      line(pt([pa[0], pa[1], 0]), pt([pb[0], pb[1], 0]), "#808995", 4 * options.size, 0.22);
    }
  }

  if (options.trail && history.length > 1) {
    for (const name of points.keys()) {
      const path = history.map((snapshot) => snapshot[name]).filter(finite).map(world).map(pt);
      for (let i = 1; i < path.length; i++) {
        line(path[i - 1], path[i], colorOf(name), Math.max(1, 1.5 * options.size), 0.08 + 0.3 * i / path.length);
      }
    }
  }
  if (options.path && history.length > 1) {
    for (const side of ["l", "r"]) {
      const path = history.map((snap) => {
        const heel = snap[side + "_heel"];
        const big = snap[side + "_big_toe"];
        const small = snap[side + "_small_toe"];
        return finite(heel) && finite(big) && finite(small) ? mul(add(add(heel, big), small), 1 / 3) : null;
      }).filter(finite).map(world).map(pt);
      for (let i = 1; i < path.length; i++) {
        line(path[i - 1], path[i], side === "l" ? LEFT : RIGHT, 3 * options.size, 0.55);
      }
    }
  }

  if (options.cameras || options.rays) {
    for (const camera of config?.cameras || []) {
      const centre = cameraCentre(camera.calibration);
      if (!centre) continue;
      const projectedCamera = pt(world(centre));
      // Rays are only meaningful for a selected reconstructed joint.
      // Show that joint's camera-centre rays in calibrated world coordinates.
      if (options.rays && selectedJoint && projected.has(selectedJoint)) {
        const selected = joints.find((joint) => joint.joint === selectedJoint);
        if (selected?.views?.includes(camera.slot)) {
          line(projectedCamera, projected.get(selectedJoint), "#d39b3f", 1.8, 0.85);
        }
      }
      if (options.cameras) {
        const p = projectedCamera;
        ctx.fillStyle = "#48556d";
        ctx.strokeStyle = "#f7f9fd";
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        ctx.moveTo(p.x, p.y - 8);
        ctx.lineTo(p.x + 8, p.y + 5);
        ctx.lineTo(p.x - 8, p.y + 5);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        ctx.font = "12px system-ui, sans-serif";
        ctx.fillText(camera.name || "camera_" + camera.slot, p.x + 11, p.y - 5);
      }
    }
  }

  if (options.soles) {
    for (const side of ["l", "r"]) {
      const keys = ["heel", "big_toe", "small_toe"].map((part) => side + "_" + part);
      if (!keys.every((k) => projected.has(k))) continue;
      const [a, b, c] = keys.map((k) => projected.get(k));
      ctx.beginPath();ctx.moveTo(a.x, a.y);ctx.lineTo(b.x, b.y);ctx.lineTo(c.x, c.y);ctx.closePath();
      ctx.fillStyle = side === "l" ? "rgba(21,158,232,0.22)" : "rgba(237,121,41,0.22)";
      ctx.fill();
    }
  }

  const drawBone = ([a, b]) => {
    const ap = projected.get(a), bp = projected.get(b);
    const palette = sideOf(a) && sideOf(a) === sideOf(b) ? colorOf(a) : BONE;
    const color = options.colour === "neutral" ? BONE : palette;
    const thick = Math.max(2.1, 4.7 * options.size * Math.min(1.5, ((ap.magnification + bp.magnification) / 2) * radius / h));
    line(ap, bp, tint(color, 0.64), thick + 1.8);
    line(ap, bp, color, thick);
    line({ x: ap.x - thick * 0.15, y: ap.y - thick * 0.16 }, { x: bp.x - thick * 0.15, y: bp.y - thick * 0.16 }, tint(color, 1.18), Math.max(0.5, thick * 0.22), 0.75);
  };
  edges.sort(([a, b], [c, d]) => ((projected.get(b).depth + projected.get(a).depth) -
    (projected.get(c).depth + projected.get(d).depth)) * -1).forEach(drawBone);

  joints.slice().sort((a, b) => projected.get(b.joint).depth - projected.get(a.joint).depth).forEach((joint) => {
    const p = projected.get(joint.joint);
    const colour = options.colour === "neutral" ? BONE : colorOf(joint.joint);
    const radiusPx = Math.max(2.1, 4.1 * options.size);
    const halo = ctx.createRadialGradient(p.x - radiusPx * 0.38, p.y - radiusPx * 0.45, 0.6, p.x, p.y, radiusPx * 1.1);
    halo.addColorStop(0, "#ffffff");
    halo.addColorStop(0.28, tint(colour, 1.22));
    halo.addColorStop(1, tint(colour, 0.64));
    ctx.beginPath();ctx.arc(p.x, p.y, radiusPx, 0, 2 * Math.PI);
    ctx.fillStyle = halo;ctx.fill();
    ctx.strokeStyle = "#eaf0f7";ctx.lineWidth = 0.8;ctx.stroke();
    if (joint.joint === selectedJoint) {
      ctx.beginPath();
      ctx.arc(p.x, p.y, radiusPx + 6, 0, Math.PI * 2);
      ctx.strokeStyle = "#d39b3f";
      ctx.lineWidth = 2.8;
      ctx.stroke();
    }
    if (options.labels && options.labelNames) {
      ctx.font = "11px system-ui, sans-serif";
      ctx.fillStyle = "#1e293b";
      ctx.fillText(joint.joint, p.x + radiusPx + 3, p.y - 4);
    }
  });

  if (options.labels) {
    for (const side of ["l", "r"]) {
      const foot = ["heel", "big_toe", "small_toe"].map((name) => projected.get(side + "_" + name));
      if (foot.some((p) => !p)) continue;
      const x = foot.reduce((v, p) => v + p.x, 0) / 3;
      const y = foot.reduce((v, p) => v + p.y, 0) / 3;
      const angle = data.foot_tilt?.[side === "l" ? "left" : "right"];
      const text = (side === "l" ? "L" : "R") + " forefoot tilt: " +
        (Number.isFinite(angle) ? (angle >= 0 ? "+" : "") + angle.toFixed(1) + "°" : "n/a");
      const atX = Math.min(w - 210, Math.max(6, x + (side === "l" ? 10 : -180)));
      const atY = Math.min(h - 8, Math.max(85, y + 36 + (side === "l" ? 0 : 22)));
      line({ x, y }, { x: atX, y: atY - 5 }, side === "l" ? LEFT : RIGHT, 1);
      ctx.font = "600 13px system-ui, sans-serif";
      ctx.fillStyle = side === "l" ? "#188ad0" : "#dd7019";
      ctx.fillText(text, atX, atY);
    }
  }

  // The hit-test uses the same projection as the canvas renderer.
  const hitTargets = [...projected].map(([joint, p]) => ({ joint, x: p.x, y: p.y }));

  // Small world-axis triad in the lower left corner.
  const triadBase = [26, h - 28];
  for (const [vector, colour, name] of [
    [[1, 0, 0], "#c64242", "X"], [[0, 1, 0], "#2f9c63", "Y"], [[0, 0, 1], "#3d70e0", "Z"],
  ]) {
    const tip = project(add(center, mul(vector, radius * 0.24)));
    const root = project(center);
    const dx = (tip.x - root.x) * 0.35, dy = (tip.y - root.y) * 0.35;
    line({ x: triadBase[0], y: triadBase[1] },
      { x: triadBase[0] + dx, y: triadBase[1] + dy }, colour, 2);
    ctx.fillStyle = colour;ctx.font = "11px sans-serif";
    ctx.fillText(name, triadBase[0] + dx + 2, triadBase[1] + dy - 2);
  }
  return hitTargets;
}

export function SkeletonCanvas3D({
  data, config, docked = false, detached = false, history = [],
  controlledView, onChangeView, controlledOptions, onChangeOptions,
  controlledSelectedJoint, onChangeSelectedJoint,
}) {
  const canvas = useRef(null);
  const drag = useRef(null);
  const hitTargets = useRef([]);
  const [internalView, setInternalView] = useState(initialView);
  const [internalOptions, setInternalOptions] = useState({
    colour: "body", size: 1, grid: true, labels: true,
    labelNames: false, cameras: false, rays: false,
    shadow: true, trail: false, path: false, soles: true,
  });
  const [internalSelectedJoint, setInternalSelectedJoint] = useState(null);
  const [dimensions, setDimensions] = useState(0);
  const view = controlledView ?? internalView;
  const setView = onChangeView ?? setInternalView;
  const options = controlledOptions ?? internalOptions;
  const setOptions = onChangeOptions ?? setInternalOptions;
  const selectedJoint = controlledSelectedJoint === undefined ? internalSelectedJoint : controlledSelectedJoint;
  const setSelectedJoint = onChangeSelectedJoint ?? setInternalSelectedJoint;

  useEffect(() => {
    const Observer = canvas.current?.ownerDocument?.defaultView?.ResizeObserver ?? (typeof ResizeObserver !== "undefined" ? ResizeObserver : null);
    const observer = Observer ? new Observer(() => setDimensions((v) => v + 1)) : null;
    if (observer && canvas.current) observer.observe(canvas.current);
    const resize = () => setDimensions((v) => v + 1);
    window.addEventListener("resize", resize);
    return () => { observer?.disconnect(); window.removeEventListener("resize", resize); };
  }, []);

  useEffect(() => {
    hitTargets.current = draw3D(canvas.current, data, config, view, options, history, selectedJoint) ?? [];
  }, [data, config, view, options, history, dimensions, selectedJoint]);

  useEffect(() => {
    const element = canvas.current;
    if (!element) return undefined;
    const wheel = (event) => {
      event.preventDefault();
      setView((old) => ({ ...old, zoom: Math.max(0.3, Math.min(6, old.zoom * Math.exp(-event.deltaY * 0.001))) }));
    };
    const preventMenu = (event) => event.preventDefault();
    element.addEventListener("wheel", wheel, { passive: false });
    element.addEventListener("contextmenu", preventMenu);
    return () => { element.removeEventListener("wheel", wheel); element.removeEventListener("contextmenu", preventMenu); };
  }, []);

  const toggle = (key) => setOptions((old) => ({ ...old, [key]: !old[key] }));
  const toggles = [["labels", "Labels"], ["cameras", "Cameras"], ["rays", "Rays"],
    ["shadow", "Shadow"], ["trail", "Trail"], ["path", "Path"], ["soles", "Soles"]];
  return (
    <section style={{
      display: "flex", flexDirection: "column", width: "100%", minWidth: 0,
      height: docked ? "100%" : undefined,
      flex: detached ? "1 1 auto" : undefined, minHeight: 0,
    }}>
      <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 7, padding: "7px 4px", fontSize: 12, background: "#fff" }}>
        <label>Colour{" "}
          <select value={options.colour} onChange={(e) => setOptions((old) => ({ ...old, colour: e.target.value }))}>
            <option value="body">Body side</option><option value="neutral">Neutral</option>
          </select>
        </label>
        <label>Size{" "}
          <input aria-label="Skeleton thickness" type="range" min="0.5" max="2.5" step="0.1" value={options.size}
            onChange={(e) => setOptions((old) => ({ ...old, size: Number(e.target.value) }))} style={{ width: 90, verticalAlign: "middle" }} />
        </label>
        {toggles.map(([key, title]) => (
          <button key={key} type="button" aria-pressed={options[key]} onClick={() => toggle(key)}
            style={{
              borderRadius: 4, border: "1px solid " + (options[key] ? "#8fa7c4" : "#d6dee9"),
              background: options[key] ? "#e9f2fd" : "#fff",
              fontSize: 12, padding: "4px 7px", cursor: "pointer",
            }}>{title}</button>
        ))}
        <button type="button" title="Show joint names" onClick={() => toggle("labelNames")}>Joint names</button>
        <button type="button" title="Reset 3D orbit" onClick={() => setView(initialView())}>Reset view</button>
        {options.rays && (
          <span style={{ color: "#875600", fontSize: 12 }}>
            {selectedJoint ? `Rays: ${selectedJoint}` : "Rays: select a joint in 3D"}
          </span>
        )}
      </div>
      <canvas
        ref={canvas} tabIndex={0}
        aria-label="3D skeleton scene: drag to rotate; Shift-drag or right-drag to pan; wheel to zoom; double click to reset"
        onDoubleClick={() => setView(initialView())}
        onPointerDown={(event) => {
          drag.current = {
            x: event.clientX, y: event.clientY, startX: event.clientX, startY: event.clientY,
            pan: event.shiftKey || event.button === 2, button: event.button,
          };
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={(event) => {
          if (!drag.current) return;
          const dx = event.clientX - drag.current.x;
          const dy = event.clientY - drag.current.y;
          setView((old) => drag.current.pan ? { ...old, pan: [old.pan[0] + dx, old.pan[1] + dy] } :
            { ...old, yaw: old.yaw - dx * 0.008, pitch: Math.max(-1.4, Math.min(1.4, old.pitch + dy * 0.006)) });
          drag.current.x = event.clientX;drag.current.y = event.clientY;
        }}
        onPointerCancel={() => { drag.current = null; }}
        onPointerUp={(event) => {
          const pointer = drag.current;
          drag.current = null;
          if (!pointer || pointer.pan || pointer.button !== 0 ||
              Math.hypot(event.clientX - pointer.startX, event.clientY - pointer.startY) > 5) return;
          const rect = event.currentTarget.getBoundingClientRect();
          const x = event.clientX - rect.left, y = event.clientY - rect.top;
          const nearest = hitTargets.current.reduce((best, target) => {
            const distance = Math.hypot(target.x - x, target.y - y);
            return distance < best.distance ? { distance, joint: target.joint } : best;
          }, { distance: Infinity, joint: null });
          setSelectedJoint(nearest.distance <= 16 * options.size ? nearest.joint : null);
        }}
        onKeyDown={(event) => {
          if (event.key.toLowerCase() === "r") setView(initialView());
          if (event.key === "+") setView((old) => ({ ...old, zoom: Math.min(6, old.zoom * 1.2) }));
          if (event.key === "-") setView((old) => ({ ...old, zoom: Math.max(0.3, old.zoom / 1.2) }));
        }}
        style={{
          width: "100%",
          height: detached ? "calc(100vh - 140px)" : docked ? "100%" : 400,
          minHeight: detached ? 260 : docked ? 180 : 260,
          flex: docked ? "1 1 auto" : undefined,
          display: "block", touchAction: "none", cursor: "grab",
        }}
      />
      <div style={{ padding: "4px 9px", color: "#64748b", fontSize: 11 }}>
        Click joint: select for Rays · Left drag: orbit · Shift/right drag: pan · Wheel: zoom · Double click or R: reset
      </div>
    </section>
  );
}
