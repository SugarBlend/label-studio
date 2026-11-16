import React, { useContext } from "react";
import { observer } from "mobx-react";
import { Circle, Group, Layer, Line } from "react-konva";
import { ReprojectionContext } from "../Skeleton3D/ReprojectionContext";
import { normalizeJoint } from "../Skeleton3D/adapter";
import { cameraColorOf } from "../Skeleton3D/topology";


/**
 * Read-only reprojection diagnostics for ONE actively selected 2D keypoint.
 *
 * Markers use per-camera point sizes with a dotted unfilled outline. The
 * colour indicates the measured 2D reprojection residual in calibration
 * pixels (green at 0, yellow at 5, red at 10+ pixels). No annotation in a
 * target camera means there is no measurable residual: draw a neutral ring.
 *
 * The 2D camera rays are epipolar curves generated from the actual observed
 * camera rays; line colour identifies the source camera. None of these
 * graphics respond to pointer events or enter annotation serialization.
 */
export const ReprojectionLayer = observer(({ item }) => {
  const state = useContext(ReprojectionContext);
  if ((!state?.enabled && !state?.camerasEnabled) || !state?.data?.joints?.length) return null;

  const entity = item.currentImageEntity;
  const width = entity?.naturalWidth;
  const height = entity?.naturalHeight;
  const index = item.currentImage ?? 0;
  const store = item.store;
  const annotation = store.annotationStore?.selected;
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 1 || height <= 1 ||
      state.task !== store.task?.id || state.annotation !== annotation?.id ||
      state.image !== item.name || state.index !== index ||
      state.width !== width || state.height !== height) return null;

  // The active region selection is the single source of truth. Multi-select,
  // deselection or selecting a non-keypoint hides all reprojection diagnostics.
  const source = annotation?.regionStore?.selection?.highlighted;
  if (!source || source.type !== "keypointregion" || source.hidden ||
      source.labels?.length !== 1 || !item.regs.some((region) => region.id === source.id)) return null;
  const jointName = normalizeJoint(source.labels[0]);
  const joint = state.data.joints.find((candidate) => candidate.joint === jointName);
  if (!joint) return null;

  const zoom = item.stageZoom;
  const viewScale = item.zoomScale;
  if (!Number.isFinite(zoom) || zoom <= 0 || !Number.isFinite(viewScale) || viewScale <= 0) return null;

  // The editable Konva marker's radius uses a per-region canvasWidth and
  // compensates for the top-level zoomScale. Using the selected source point
  // on every camera was incorrect: each camera can have its own point size.
  const regionForSlot = new Map();
  for (const region of item.regs) {
    if (region.type !== "keypointregion" || region.hidden ||
        region.labels?.length !== 1 || normalizeJoint(region.labels[0]) !== jointName ||
        !Number.isFinite(region.x) || !Number.isFinite(region.y) ||
        (region.item_index ?? 0) !== index) continue;
    const slot = (region.y >= 50 ? 2 : 0) + (region.x >= 50 ? 1 : 0);
    if (!regionForSlot.has(slot)) regionForSlot.set(slot, region);
  }
  const pointRadius = (region) => {
    if (!region) return null;
    // Prefer the exact Konva radius when already mounted, otherwise match
    // HtxKeyPointView's formula without introducing another scale factor.
    const liveRadius = region.shapeRef?.radius?.();
    const radius = Number.isFinite(liveRadius) && liveRadius > 0
      ? liveRadius : Math.max(region.canvasWidth, 2) / viewScale;
    return Number.isFinite(radius) && radius > 0 ? radius : null;
  };
  const sourceRadius = pointRadius(source);
  if (!sourceRadius) return null;

  // Error is in calibration-image pixels, NOT screen pixels. The UI uses
  // the same 10 px warning cutoff as the existing 3D quality diagnostics.
  const errorColor = (error) => {
    if (!Number.isFinite(error)) return "#94a3b8"; // no labelled observation
    const t = Math.max(0, Math.min(1, error / 10));
    // green -> yellow -> red (linear RGB, continuously interpolated).
    const start = t <= 0.5 ? [34, 197, 94] : [234, 179, 8];
    const end = t <= 0.5 ? [234, 179, 8] : [239, 68, 68];
    const alpha = t <= 0.5 ? t * 2 : (t - 0.5) * 2;
    return "#" + start.map((v, i) => Math.round(v + (end[i] - v) * alpha)
      .toString(16).padStart(2, "0")).join("");
  };

  const cameras = state.cameras ?? [];
  const cameraBySlot = new Map(cameras.map((camera) => [camera.slot, camera]));
  const toMosaic = (slot, x, y) => {
    const camera = cameraBySlot.get(slot);
    if (!camera || !(camera.image_width > 0 && camera.image_height > 0) ||
        !Number.isFinite(x) || !Number.isFinite(y)) return null;
    return [
      ((slot % 2) + x / camera.image_width) * width * zoom / 2,
      (Math.floor(slot / 2) + y / camera.image_height) * height * zoom / 2,
    ];
  };

  const curves = [];
  if (state.camerasEnabled) {
    for (const ray of joint.ray_projections ?? []) {
      if (!Array.isArray(ray.path) || ray.path.length < 2) continue;
      const vertices = ray.path.map(([x, y]) => toMosaic(ray.target_slot, x, y)).filter(Boolean);
      if (vertices.length < 2) continue;
      // Lens distortion means the epipolar locus can be curved. Clip it
      // within its destination camera quadrant to avoid crossing tiles.
      curves.push(
        <Group
          key={`ray:${joint.joint}:${ray.source_slot}:${ray.target_slot}`}
          clipX={(ray.target_slot % 2) * width * zoom / 2}
          clipY={Math.floor(ray.target_slot / 2) * height * zoom / 2}
          clipWidth={width * zoom / 2}
          clipHeight={height * zoom / 2}
          listening={false}
        >
          <Line
            points={vertices.flat()}
            stroke={cameraColorOf(ray.source_slot)}
            strokeWidth={1.8}
            opacity={0.75}
            dash={[7, 5]}
            lineCap="round"
            strokeScaleEnabled={false}
            perfectDrawEnabled={false}
            listening={false}
          />
        </Group>,
      );
    }
  }

  const projections = [];
  if (state.enabled) {
    const errorBySlot = new Map((joint.reprojection_errors ?? []).map(
      ({ slot, error_px }) => [slot, error_px],
    ));

    for (const point of joint.reprojections ?? []) {
      const pos = toMosaic(point.slot, point.x, point.y);
      if (!pos) continue;
      const [x, y] = pos;
      const tileX = (point.slot % 2) * width * zoom / 2;
      const tileY = Math.floor(point.slot / 2) * height * zoom / 2;
      if (x < tileX || x > tileX + width * zoom / 2 ||
          y < tileY || y > tileY + height * zoom / 2) continue;

      const observed = regionForSlot.get(point.slot);
      const radius = pointRadius(observed) ?? sourceRadius;
      const color = errorColor(errorBySlot.get(point.slot));

      // Draw the displacement between the actual annotation and the 3D
      // projection, as in the reference image. Both ends use the same Konva
      // stage coordinate system, so there is no extra zoom conversion.
      if (observed && Number.isFinite(observed.canvasX) && Number.isFinite(observed.canvasY)) {
        projections.push(
          <Line
            key={`residual:${point.slot}:${joint.joint}`}
            points={[observed.canvasX, observed.canvasY, x, y]}
            stroke={color}
            strokeWidth={1.8}
            opacity={0.9}
            strokeScaleEnabled={false}
            perfectDrawEnabled={false}
            listening={false}
          />,
        );
      }
      projections.push(
        <Circle
          key={`projection:${point.slot}:${joint.joint}`}
          x={x}
          y={y}
          radius={radius}
          stroke={color}
          strokeWidth={2}
          dash={[3, 3]}
          fillEnabled={false}
          strokeScaleEnabled={false}
          perfectDrawEnabled={false}
          listening={false}
        />,
      );
    }
  }

  return (curves.length || projections.length)
    ? <Layer listening={false}>{curves}{projections}</Layer>
    : null;
});
