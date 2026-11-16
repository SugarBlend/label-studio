import React, { useContext } from "react";
import { observer } from "mobx-react";
import { Circle, Group, Layer, Line } from "react-konva";
import { ReprojectionContext } from "../Skeleton3D/ReprojectionContext";
import { colorOf } from "../Skeleton3D/topology";

/**
 * Read-only dotted projections of reconstructed 3D joints. Native camera
 * pixels are mapped into the original four-quadrant mosaic, then transformed
 * exactly once with the same stageZoom as the raster image.
 *
 * These Konva shapes never receive events and are never serialized as regions.
 */
export const ReprojectionLayer = observer(({ item }) => {
  const state = useContext(ReprojectionContext);
  if ((!state?.enabled && !state?.camerasEnabled) || !state?.data?.joints?.length) return null;

  const entity = item.currentImageEntity;
  const width = entity?.naturalWidth;
  const height = entity?.naturalHeight;
  const index = item.currentImage ?? 0;
  const store = item.store;
  const active = store.annotationStore?.selected;
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 1 || height <= 1 ||
      state.task !== store.task?.id || state.annotation !== active?.id ||
      state.image !== item.name || state.index !== index ||
      state.width !== width || state.height !== height) {
    return null;
  }

  const cameras = state.cameras ?? [];
  const zoom = item.stageZoom;
  if (!Number.isFinite(zoom) || zoom <= 0) return null;

  const circles = [];
  const curves = [];
  const cameraBySlot = new Map(cameras.map((camera) => [camera.slot, camera]));
  const toMosaic = (slot, x, y) => {
    const camera = cameraBySlot.get(slot);
    if (!camera || !(camera.image_width > 0 && camera.image_height > 0)) return null;
    return [
      ((slot % 2) + x / camera.image_width) * width * zoom / 2,
      (Math.floor(slot / 2) + y / camera.image_height) * height * zoom / 2,
    ];
  };
  for (const joint of state.data.joints) {
    const color = colorOf(joint.joint);
    if (state.camerasEnabled) {
      for (const ray of joint.ray_projections ?? []) {
        const camera = cameraBySlot.get(ray.target_slot);
        if (!camera || !Array.isArray(ray.path) || ray.path.length < 2) continue;
        const vertices = ray.path.map(([x, y]) => toMosaic(ray.target_slot, x, y)).filter(Boolean);
        if (vertices.length < 2) continue;
        // Confine each projected ray to its own camera tile. With lens
        // distortion the epipolar locus is a curve, not a straight line.
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
              stroke={color}
              strokeWidth={1.4}
              opacity={0.24}
              dash={[7, 6]}
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
    for (const point of joint.reprojections ?? []) {
      const camera = cameras.find((entry) => entry.slot === point.slot);
      if (!camera || !(camera.image_width > 0 && camera.image_height > 0) ||
          !Number.isFinite(point.x) || !Number.isFinite(point.y)) continue;
      const x = ((point.slot % 2) + point.x / camera.image_width) * width / 2;
      const y = (Math.floor(point.slot / 2) + point.y / camera.image_height) * height / 2;
      if (!Number.isFinite(x) || !Number.isFinite(y) ||
          x < 0 || x > width || y < 0 || y > height) continue;

      const key = `${point.slot}:${joint.joint}`;
      circles.push(
        <Circle
          key={`${key}:outline`}
          x={x * zoom}
          y={y * zoom}
          radius={8}
          stroke={color}
          strokeWidth={1.6}
          opacity={0.4}
          dash={[2, 3]}
          strokeScaleEnabled={false}
          perfectDrawEnabled={false}
          listening={false}
        />,
        <Circle
          key={`${key}:centre`}
          x={x * zoom}
          y={y * zoom}
          radius={2}
          fill={color}
          opacity={0.35}
          stroke="#ffffff"
          strokeWidth={0.75}
          strokeScaleEnabled={false}
          perfectDrawEnabled={false}
          listening={false}
        />,
      );
    }
  }

  return (circles.length || curves.length) ? <Layer listening={false}>{curves}{circles}</Layer> : null;
});
