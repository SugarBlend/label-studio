import React, { useContext } from "react";
import { observer } from "mobx-react";
import { Circle, Group, Layer, Line } from "react-konva";
import { ReprojectionContext } from "../Skeleton3D/ReprojectionContext";
import { normalizeJoint } from "../Skeleton3D/adapter";
import { cameraColorOf } from "../Skeleton3D/topology";
import { getRegionStyles } from "../../hooks/useRegionColor";

/**
 * Read-only reprojection diagnostics for ONE actively selected 2D keypoint.
 *
 * The marker mirrors that region's actual canvas radius and Label Studio
 * fill/stroke/opacity rules (KeyPointRegion.jsx/useRegionColor.ts). There
 * is no hard-coded 8px size, 0.4 opacity, or tiny fallback radius.
 * The dotted outline distinguishes a projected point from a saved region.
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

  // Prefer the visible source Konva circle when available. This is the
  // exact radius displayed in Label Studio. Otherwise use the identical
  // KeyPointRegion formula, never an unrelated stage-width fallback.
  const renderedRadius = source.shapeRef?.radius?.();
  const radius = Number.isFinite(renderedRadius) && renderedRadius > 0
    ? renderedRadius
    : Math.max(source.canvasWidth, 2) / viewScale;
  if (!Number.isFinite(radius) || radius <= 0) return null;

  // Use exactly the same style resolution as HtxKeyPointView, including
  // KeyPointLabels/KeyPoint opacity, fillcolor and strokecolor from config.
  // Alpha is embedded in fillColor; do not multiply it by a second opacity.
  const regionStyles = getRegionStyles({
    region: source,
    shouldFill: true,
    defaultFillColor: "#000",
    defaultStrokeColor: "#fff",
    defaultOpacity: (source.style ?? source.tag) ? 0.6 : 1,
    sameStrokeWidthForSelected: true,
  });

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
    for (const point of joint.reprojections ?? []) {
      const pos = toMosaic(point.slot, point.x, point.y);
      if (!pos) continue;
      const [x, y] = pos;
      const tileX = (point.slot % 2) * width * zoom / 2;
      const tileY = Math.floor(point.slot / 2) * height * zoom / 2;
      if (x < tileX || x > tileX + width * zoom / 2 ||
          y < tileY || y > tileY + height * zoom / 2) continue;

      projections.push(
        <Circle
          key={`projection:${point.slot}:${joint.joint}`}
          x={x}
          y={y}
          radius={radius}
          fill={regionStyles.fillColor}
          stroke={regionStyles.strokeColor}
          strokeWidth={Math.max(1, regionStyles.strokeWidth)}
          dash={[2, 3]}
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
