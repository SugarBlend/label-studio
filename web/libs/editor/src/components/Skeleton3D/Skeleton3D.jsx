import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { reaction } from "mobx";
import { adaptSkeleton, createReconstructionRunner, readSkeletonSnapshot } from "./adapter";
import { requestReconstruction } from "./request";
import { SkeletonCanvas3D } from "./SkeletonCanvas3D";

const formatAngle = (value) => (Number.isFinite(value) ? `${value >= 0 ? "+" : "−"}${Math.abs(value).toFixed(1)}°` : "n/a");

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
export function Skeleton3D({ store, config, docked = false, popupOnly = false }) {
  const [state, setState] = useState({ status: "pending", data: null });
  // Temporary in-memory reconstruction history for the Trail / Path toggles.
  // No points or trajectories are saved into the Label Studio annotations.
  const history = useRef([]);
  const [panel, setPanel] = useState(readPanelState);
  const box = useRef(null);
  const moving = useRef(null);
  const anchor = useRef(null);
  const popupWindow = useRef(null);
  const [popout, setPopout] = useState(null);
  // Hoist the scene controls so that detaching/reattaching the portal never
  // resets the orbit, visual layers, or selected joint.
  const [sceneView, setSceneView] = useState(() => {
    const defaults = { yaw: -1.1, pitch: 0.23, zoom: 1, pan: [0, 0] };
    try {
      const saved = JSON.parse(window.localStorage.getItem("ls.skeleton3d.camera") ?? "null");
      return saved &&
        Number.isFinite(saved.yaw) && Number.isFinite(saved.pitch) &&
        Number.isFinite(saved.zoom) && saved.zoom > 0 &&
        Array.isArray(saved.pan) && saved.pan.length === 2 && saved.pan.every(Number.isFinite)
        ? { yaw: saved.yaw, pitch: saved.pitch, zoom: saved.zoom, pan: saved.pan }
        : defaults;
    } catch {
      return defaults;
    }
  });
  const [sceneOptions, setSceneOptions] = useState({
    colour: "body", size: 1, grid: true, labels: true,
    labelNames: false, cameras: false, rays: false,
    shadow: true, trail: false, path: false, soles: true,
  });
  const [selectedJoint, setSelectedJoint] = useState(null);
  const [sourceId, setSourceId] = useState("auto");
  const [availableSources, setAvailableSources] = useState([]);
  const currentTaskRef = useRef(null);
  useEffect(() => {
    try { window.localStorage.setItem("ls.skeleton3d.camera", JSON.stringify(sceneView)); }
    catch { /* Local storage can be disabled in private mode. */ }
  }, [sceneView]);

  const openPopout = () => {
    if (popout && !popout.win.closed) {
      popout.win.focus();
      return;
    }
    // Must be called synchronously from the button click: browser popup blockers
    // otherwise reject the secondary monitor window.
    const win = window.open("", "labelstudio-live-skeleton3d", "popup=yes,width=1100,height=850,resizable=yes,scrollbars=yes");
    if (!win) {
      window.alert("The browser blocked the 3D window. Allow popups for this Label Studio origin.");
      return;
    }
    const doc = win.document;
    doc.title = "Label Studio — live 3D skeleton";
    doc.body.replaceChildren();
    doc.body.style.margin = "0";
    doc.body.style.background = "#f6f8fc";
    doc.body.style.fontFamily = "system-ui, sans-serif";
    doc.body.style.color = "#25303f";
    const style = doc.createElement("style");
    style.textContent = "*,*::before,*::after{box-sizing:border-box}button,select,input{font:inherit}button{cursor:pointer}#skeleton3d-popout{width:100%;min-height:100vh;display:flex;flex-direction:column}";
    doc.head.appendChild(style);
    const root = doc.createElement("div");
    root.id = "skeleton3d-popout";
    doc.body.appendChild(root);
    popupWindow.current = win;
    setPopout({ win, root });
    win.focus();
  };
  const attachPopout = () => {
    const win = popupWindow.current;
    popupWindow.current = null;
    setPopout(null);
    if (win && !win.closed) win.close();
  };
  useEffect(() => {
    if (popupOnly) return undefined;
    const mainView = anchor.current?.closest(".main-view--skeleton3d");
    if (popout) mainView?.classList.add("main-view--skeleton3d-detached");
    else mainView?.classList.remove("main-view--skeleton3d-detached");
    return () => mainView?.classList.remove("main-view--skeleton3d-detached");
  }, [popout, popupOnly]);
  useEffect(() => {
    if (!popout) return undefined;
    const handleClosed = () => {
      if (popupWindow.current === popout.win) {
        popupWindow.current = null;
        setPopout(null);
      }
    };
    popout.win.addEventListener("beforeunload", handleClosed);
    return () => popout.win.removeEventListener("beforeunload", handleClosed);
  }, [popout]);
  useEffect(() => () => {
    const win = popupWindow.current;
    if (win && !win.closed) win.close();
    popupWindow.current = null;
  }, []);
  // Snapshot the full calibration: changing it invalidates an in-flight response.
  const configKey = JSON.stringify(config);
  useEffect(() => {
    // An unopened popup must not reconstruct on every 2D drag:
    // start the live MobX subscription only while the 3D window is visible.
    if (popupOnly && !popout) return undefined;
    const settings = JSON.parse(configKey);
    const runner = createReconstructionRunner({
      request: requestReconstruction,
      onState: (next) => {
        if (next.status === "ready" && Array.isArray(next.data?.joints)) {
          const accepted = next.data.joints.filter((j) =>
            Number.isFinite(j.rms_reprojection_error_px) && j.rms_reprojection_error_px <= 10);
          // Do not record trails from globally inconsistent reconstructions.
          if (accepted.length > next.data.joints.length / 2) {
            const frame = Object.fromEntries(accepted.map((joint) => [joint.joint, joint.position]));
            const last = history.current[history.current.length - 1];
            if (JSON.stringify(frame) !== JSON.stringify(last)) history.current = [...history.current, frame].slice(-90);
          }
        }
        // Keep the last good 3D pose on screen during the debounce/request:
        // otherwise dragging one 2D point unmounts the 3D canvas on every tick.
        setState((previous) => next.status === "pending" && previous.data
          ? { ...next, data: previous.data }
          : next);
      },
    });
    const dispose = reaction(
      () => JSON.stringify(readSkeletonSnapshot(store, sourceId)),
      (snapshot) => {
        const current = JSON.parse(snapshot);
        setAvailableSources((previous) =>
          JSON.stringify(previous) === JSON.stringify(current.sources) ? previous : current.sources);
        if (current.task !== currentTaskRef.current) {
          currentTaskRef.current = current.task;
          history.current = [];
          setSelectedJoint(null);
          setSourceId("auto");
          setState({ status: "pending", data: null, error: null, notes: [] });
        }
        runner.update({ ...adaptSkeleton(current, settings), config: settings });
      },
      { fireImmediately: true },
    );
    return () => { dispose(); runner.dispose(); };
  }, [store, configKey, sourceId, popupOnly, Boolean(popout)]);
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
  const rejectedByQuality = (data?.joints ?? []).filter((joint) =>
    Number.isFinite(joint.rms_reprojection_error_px) && joint.rms_reprojection_error_px > 10);
  const goodJoints = (data?.joints ?? []).filter((joint) =>
    Number.isFinite(joint.rms_reprojection_error_px) && joint.rms_reprojection_error_px <= 10);
  // Suppress a globally wrong pose rather than presenting impossible bone lengths.
  const unreliable = !!data?.joints?.length && rejectedByQuality.length >= Math.ceil(data.joints.length / 2);
  const names = new Set(goodJoints.map((joint) => joint.joint));
  const validFoot = (side) => ["heel", "big_toe", "small_toe"].every((part) => names.has(`${side}_${part}`));
  const safeData = data && !unreliable ? {
    ...data,
    joints: goodJoints,
    foot_tilt: {
      left: validFoot("l") ? data.foot_tilt?.left : null,
      right: validFoot("r") ? data.foot_tilt?.right : null,
    },
  } : null;
  const warnings = [
    ...(state.notes ?? []),
    ...(data?.warnings ?? []).map((w) => (typeof w === "string" ? w : JSON.stringify(w))),
    ...(data?.rejected ?? []).map((r) => `${r.joint}: ${r.reason}`),
  ];
  const status = state.status === "pending" ? "reconstructing…" : state.status === "ready" ? "drag to orbit · wheel to zoom" : "";
  const angles = safeData ? `L ${formatAngle(safeData.foot_tilt?.left)} · R ${formatAngle(safeData.foot_tilt?.right)}` : "";
  const scene = (
    <section ref={box} aria-label="Live 3D skeleton"
      style={{
        ...(docked || popupOnly ? {
          position: "relative", width: "100%", height: popout ? "100vh" : "100%",
          minHeight: 0, maxHeight: "100%", overflow: "hidden",
          border: "none", borderRadius: 0, boxShadow: "none",
        } : {
          position: "fixed", zIndex: 1200, width: "min(440px, 92vw)", maxHeight: "80vh",
          border: "1px solid #cbd5e1", borderRadius: 8, boxShadow: "0 10px 28px rgba(15, 23, 42, 0.18)",
          ...(panel.position ? { left: panel.position.left, top: panel.position.top } : { right: 16, bottom: 16 }),
        }),
        display: "flex", flexDirection: "column", background: "#ffffff",
      }}>
      <header
        style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 8px", cursor: docked ? "default" : "grab", userSelect: "none", borderBottom: panel.collapsed && !docked ? "none" : "1px solid #e2e8f0" }}
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
          {panel.collapsed && !docked ? angles : status}
        </span>
        {warnings.length > 0 && <span title="Warnings" style={{ fontSize: 11, color: "#b45309" }}>⚠{warnings.length}</span>}
        <span style={{ flex: 1 }} />
        <button type="button" title={popupOnly ? "Close the separate 3D window" : popout ? "Return 3D to the Label Studio editor" : "Open 3D in a separate window"}
          onClick={popout ? attachPopout : openPopout}
          style={{ border: "1px solid #cbd5e1", borderRadius: 4, padding: "4px 9px", background: "#f8fafc", fontSize: 12 }}>
          {popupOnly ? "Close 3D" : popout ? "Return to editor" : "Open in window ↗"}
        </button>
        {!docked && !popupOnly && <button type="button" aria-expanded={!panel.collapsed} title={panel.collapsed ? "Expand" : "Collapse"}
          onClick={() => setPanel((current) => ({ ...current, collapsed: !current.collapsed }))}
          style={{ border: "none", background: "transparent", cursor: "pointer", fontSize: 14, lineHeight: 1, padding: "2px 6px" }}>
          {panel.collapsed ? "▢" : "–"}
        </button>}
      </header>
      {(docked || popupOnly || !panel.collapsed) && (
        <div style={{
          padding: "8px 10px 10px", overflow: "auto", flex: "1 1 auto",
          minHeight: 0, height: "100%", overscrollBehavior: "contain",
        }}>
          {availableSources.length > 0 && (
            <label style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", fontSize: 12, paddingBottom: 7 }}>
              <strong>3D source</strong>
              <select value={sourceId} onChange={(event) => setSourceId(event.target.value)}
                aria-label="3D reconstruction annotation source"
                style={{ minWidth: 180, maxWidth: "100%", padding: "4px 6px" }}>
                <option value="auto">Auto: selected annotation, or first populated</option>
                {availableSources.map((source) => (
                  <option key={source.id} value={source.id}>
                    {source.type}: {source.label} ({source.count} points)
                  </option>
                ))}
              </select>
            </label>
          )}
          <div role="status" aria-live="polite" style={{ fontSize: 12, color: "#b91c1c" }}>{state.error}</div>
          {rejectedByQuality.length > 0 && (
            <div role="alert" style={{
              padding: "9px 11px", margin: "8px 0", border: "1px solid #f4b38c",
              background: "#fff7ed", borderRadius: 5, color: "#9a3412", fontSize: 12,
            }}>
              <strong>3D reconstruction quality problem:</strong> {rejectedByQuality.length} of {data.joints.length} joints
              have a reprojection RMS above 10 px.
              {unreliable
                ? " The 3D skeleton is hidden because the camera geometry is inconsistent."
                : " Unreliable joints and their connecting bones are hidden."}
              {" "}Check Settings → 3D skeleton: enter the camera resolution corresponding to the
              intrinsics, not an unrelated preview size. For the supplied 3840×2160 Foots mosaic use 1920×1080
              per camera. Check camera order and raw/undistorted image settings.
              Open Warnings and Reconstruction quality below to identify the failing camera slots.
            </div>
          )}
          <SkeletonCanvas3D data={safeData ?? { joints: [], edges: [] }} config={config} docked={docked || popupOnly}
            detached={Boolean(popout)} history={history.current}
            controlledView={sceneView} onChangeView={setSceneView}
            controlledOptions={sceneOptions} onChangeOptions={setSceneOptions}
            controlledSelectedJoint={selectedJoint} onChangeSelectedJoint={setSelectedJoint} />
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
  if (popupOnly) {
    return (
      <>
        <button
          type="button"
          className="main-view__show-3d"
          onClick={openPopout}
          aria-label="Show 3D skeleton in a separate window"
          title={popout && !popout.win.closed ? "Focus the open 3D window" : "Open live 3D skeleton on a second screen"}
        >
          Show 3D ↗
        </button>
        {popout && !popout.win.closed && createPortal(scene, popout.root)}
      </>
    );
  }
  return (
    <>
      <span ref={anchor} style={{ display: "none" }} aria-hidden="true" />
      {popout ? createPortal(scene, popout.root) : scene}
    </>
  );
}
