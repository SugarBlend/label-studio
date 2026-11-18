import React, { useContext } from "react";
import { observer } from "mobx-react";
import { Circle, Group, Layer, Line } from "react-konva";
import { ReprojectionContext } from "../Skeleton3D/ReprojectionContext";
import { normalizeJoint } from "../Skeleton3D/adapter";
import { cameraColorOf } from "../Skeleton3D/topology";

/**
 * Read-only 2D reconstruction diagnostics:
 * - Show Reprojection: all triangulated joints in all calibrated cameras.
 * - Cameras: epipolar curves for the one selected keypoint only.
 * - Residual displacement lines: for all annotated keypoints with a
 *   corresponding 3D projection, regardless of selection.
 *
 * Reprojection rings are unfilled, coloured by each camera's native-pixel
 * residual (green 0px, yellow 5px, red >=10px, gray if unannotated).
 * Markers use the radius of their original 2D region, or the nearest
 * visible point in the same camera if the original point was deleted.
 * No shape here is interactive or stored in an annotation.
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

  const zoom = item.stageZoom;
  const viewScale = item.zoomScale;
  if (!Number.isFinite(zoom) || zoom <= 0 || !Number.isFinite(viewScale) || viewScale <= 0) return null;

  // Camera rays are selection-dependent. Reprojection markers AND residual
  // displacement vectors do not depend on an active selection.
  const selectedRegion = annotation?.regionStore?.selection?.highlighted;
  const selectedJointName = selectedRegion?.type === "keypointregion" &&
    !selectedRegion.hidden && selectedRegion.labels?.length === 1 &&
    (selectedRegion.item_index ?? 0) === index &&
    item.regs.some((region) => region.id === selectedRegion.id)
    ? normalizeJoint(selectedRegion.labels[0])
    : null;

  // Index all real keypoints once so each camera gets its own reference
  // size, native-pixel error, and existing 2D position. Reprojection of a
  // joint without a region in a given camera uses the SAME joint in one
  // of the other cameras for its fallback radius.
  const regionsByJoint = new Map();
  const visibleRegionsByCamera = [[], [], [], []];
  for (const region of item.regs) {
    if (region.type !== "keypointregion" || region.hidden ||
        region.labels?.length !== 1 || !Number.isFinite(region.x) ||
        !Number.isFinite(region.y) || (region.item_index ?? 0) !== index) continue;
    const jointName = normalizeJoint(region.labels[0]);
    const slot = (region.y >= 50 ? 2 : 0) + (region.x >= 50 ? 1 : 0);
    if (!regionsByJoint.has(jointName)) regionsByJoint.set(jointName, new Map());
    const bySlot = regionsByJoint.get(jointName);
    if (!bySlot.has(slot)) bySlot.set(slot, region);
    visibleRegionsByCamera[slot].push(region);
  }

  const pointRadius = (region) => {
    if (!region) return null;
    const liveRadius = region.shapeRef?.radius?.();
    // Match the editable KeyPointRegion's local radius and top-level zoom
    // compensation; the entire Stage already owns zoomScale.
    const radius = Number.isFinite(liveRadius) && liveRadius > 0
      ? liveRadius : Math.max(region.canvasWidth, 2) / viewScale;
    return Number.isFinite(radius) && radius > 0 ? radius : null;
  };

  // When a joint is missing in a camera, its deleted KeyPointRegion no
  // longer exists in MobX and therefore no longer has a reliable width.
  // Infer the marker size from the NEAREST surviving point in that camera.
  // If that camera has no points at all, use the median displayed radius
  // across the other cameras. Never borrow the corresponding joint's
  // potentially very different width from another camera.
  const globalRadii = visibleRegionsByCamera.flat()
    .map(pointRadius).filter((radius) => radius !== null).sort((a, b) => a - b);
  const median = (values) => values[Math.floor(values.length / 2)] ?? null;
  const globalFallbackRadius = median(globalRadii);

  const missingPointRadius = (slot, x, y) => {
    const candidates = visibleRegionsByCamera[slot] ?? [];
    let nearest = null;
    let nearestSquaredDistance = Infinity;
    for (const region of candidates) {
      const dx = region.canvasX - x;
      const dy = region.canvasY - y;
      const radius = pointRadius(region);
      if (!Number.isFinite(dx) || !Number.isFinite(dy) || radius === null) continue;
      const squaredDistance = dx * dx + dy * dy;
      if (squaredDistance < nearestSquaredDistance) {
        nearest = radius;
        nearestSquaredDistance = squaredDistance;
      }
    }
    return nearest ?? globalFallbackRadius;
  };

  const errorColor = (error) => {
    if (!Number.isFinite(error)) return "#94a3b8";
    const t = Math.max(0, Math.min(1, error / 10));
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
  const projections = [];

  for (const joint of state.data.joints) {
    const isSelected = selectedJointName !== null && joint.joint === selectedJointName;

    // The Cameras toggle never draws rays for unselected joints.
    if (state.camerasEnabled && isSelected) {
      for (const ray of joint.ray_projections ?? []) {
        if (!Array.isArray(ray.path) || ray.path.length < 2) continue;
        const vertices = ray.path.map(([x, y]) => toMosaic(ray.target_slot, x, y)).filter(Boolean);
        if (vertices.length < 2) continue;
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
              lineCap="round"
              strokeScaleEnabled={false}
              perfectDrawEnabled={false}
              listening={false}
            />
          </Group>,
        );
      }
    }

    if (!state.enabled) continue;

    const bySlot = regionsByJoint.get(joint.joint);

    for (const point of joint.reprojections ?? []) {
      const pos = toMosaic(point.slot, point.x, point.y);
      if (!pos) continue;
      const [x, y] = pos;
      const tileX = (point.slot % 2) * width * zoom / 2;
      const tileY = Math.floor(point.slot / 2) * height * zoom / 2;
      if (x < tileX || x > tileX + width * zoom / 2 ||
          y < tileY || y > tileY + height * zoom / 2) continue;

      const observed = bySlot?.get(point.slot);
      const radius = pointRadius(observed) ?? missingPointRadius(point.slot, x, y);
      if (radius === null) continue;
      const camera = cameraBySlot.get(point.slot);
      const column = point.slot % 2;
      const row = Math.floor(point.slot / 2);
      const observedX = observed && camera
        ? (observed.x / 50 - column) * camera.image_width
        : NaN;
      const observedY = observed && camera
        ? (observed.y / 50 - row) * camera.image_height
        : NaN;
      const errorPx = Number.isFinite(observedX) && Number.isFinite(observedY)
        ? Math.hypot(point.x - observedX, point.y - observedY)
        : NaN;
      const color = errorColor(errorPx);

      // Always join the actual annotation centre with its projection.
      // Both endpoints are expressed in unzoomed stage coordinates; the
      // parent Konva Stage applies zoom to the entire read-only layer.
      // For a zero-error projection the line has zero length, correctly
      // indicating that both centres coincide.
      if (observed &&
          Number.isFinite(observed.canvasX) && Number.isFinite(observed.canvasY)) {
        projections.push(
          <Line
            key={`residual:${point.slot}:${joint.joint}`}
            points={[observed.canvasX, observed.canvasY, x, y]}
            stroke={color}
            strokeWidth={2}
            opacity={1}
            lineCap="round"
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
