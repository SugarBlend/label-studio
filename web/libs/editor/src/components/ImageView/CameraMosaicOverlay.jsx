import React from "react";
import { observer } from "mobx-react";
import { Layer, Line, Text } from "react-konva";

/** Read-only 2x2 camera tile names and dividers. No implicit skeleton links. */
export const CameraMosaicOverlay = observer(({ item, cameras = [] }) => {
  const image = item.currentImageEntity;
  const width = image?.naturalWidth * item.stageZoom;
  const height = image?.naturalHeight * item.stageZoom;
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null;

  const names = Array.from({ length: 4 }, (_, slot) =>
    cameras.find((camera) => Number(camera.slot) === slot)?.name || `camera_${slot}`);
  const inset = Math.max(10, Math.min(18, width / 150));
  const fontSize = Math.max(14, Math.min(22, width / 110));


  return (
    <Layer listening={false}>
      {/* Thin dividers and camera names only — no banners or background plates. */}
      <Line points={[width / 2, 0, width / 2, height]} stroke="#263142" strokeWidth={2} strokeScaleEnabled={false} />
      <Line points={[0, height / 2, width, height / 2]} stroke="#263142" strokeWidth={2} strokeScaleEnabled={false} />
      {names.map((name, slot) => (
        <Text
          key={`camera-name-${slot}`}
          x={(slot % 2) * width / 2 + inset}
          y={Math.floor(slot / 2) * height / 2 + inset}
          text={name}
          fontFamily="Arial, sans-serif"
          fontSize={fontSize}
          fontStyle="bold"
          fill="#ffffff"
          stroke="#111827"
          strokeWidth={3}
          fillAfterStrokeEnabled
          shadowColor="#000000"
          shadowBlur={4}
          shadowOpacity={0.8}
          listening={false}
        />
      ))}

    </Layer>
  );
});
