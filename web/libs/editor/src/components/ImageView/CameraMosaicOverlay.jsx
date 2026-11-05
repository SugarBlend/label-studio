import React from "react";
import { observer } from "mobx-react";
import { Layer, Line, Rect, Text } from "react-konva";
import { normalizeJoint } from "../Skeleton3D/adapter";
import { colorOf, standardEdges, sideOf } from "../Skeleton3D/topology";

/**
 * Read-only decoration of the single 2x2 source mosaic.
 *
 * The Konva canvas is still the original Label Studio image, so points can
 * be dragged, selected, undone and saved as before. The overlay only draws
 * camera headers and implicit skeleton links not already represented by a
 * user-created Relation. It never creates or changes annotations.
 */
export const CameraMosaicOverlay = observer(({ item }) => {
  const image = item.currentImageEntity;
  const width = image?.naturalWidth * item.stageZoom;
  const height = image?.naturalHeight * item.stageZoom;
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null;

  const regions = item.regs.filter((region) => region.type === "keypointregion" && !region.hidden);
  const cells = Array.from({ length: 4 }, () => new Map());
  const counts = [0, 0, 0, 0];
  for (const region of regions) {
    if (![region.x, region.y, region.canvasX, region.canvasY].every(Number.isFinite)) continue;
    const slot = (region.y >= 50 ? 2 : 0) + (region.x >= 50 ? 1 : 0);
    const joint = region.labels?.length === 1 ? normalizeJoint(region.labels[0]) : "";
    if (!joint) continue;
    counts[slot]++;
    if (!cells[slot].has(joint)) cells[slot].set(joint, region);
  }

  const existing = new Set();
  const relations = item.annotation?.relationStore?.relations ?? [];
  for (const relation of relations) {
    if (!relation.node1 || !relation.node2) continue;
    existing.add([relation.node1.id, relation.node2.id].sort().join("|"));
  }

  const headerHeight = Math.min(29, height / 10);
  return (
    <Layer listening={false}>
      {/* Cell dividers follow the image's own coordinate system during zoom and pan. */}
      <Line points={[width / 2, 0, width / 2, height]} stroke="#263142" strokeWidth={3} strokeScaleEnabled={false} />
      <Line points={[0, height / 2, width, height / 2]} stroke="#263142" strokeWidth={3} strokeScaleEnabled={false} />
      {[0, 1, 2, 3].map((slot) => {
        const x = (slot % 2) * width / 2;
        const y = Math.floor(slot / 2) * height / 2;
        return (
          <React.Fragment key={slot}>
            <Rect x={x} y={y} width={width / 2} height={headerHeight} fill="rgba(17,24,39,0.86)" />
            <Rect x={x} y={y} width={5} height={headerHeight} fill={slot % 2 === 0 ? "#159ee8" : "#ed7929"} />
            <Text
              x={x + 11}
              y={y + 7}
              text={`camera_${slot}  ·  ${counts[slot]} joints`}
              fontFamily="Arial"
              fontStyle="bold"
              fontSize={12}
              fill="#f8fafc"
            />
          </React.Fragment>
        );
      })}
      {cells.flatMap((cell, slot) => standardEdges.map(([from, to]) => {
        const a = cell.get(from);
        const b = cell.get(to);
        if (!a || !b) return null;
        if (existing.has([a.id, b.id].sort().join("|"))) return null;
        const color = sideOf(from) && sideOf(from) === sideOf(to) ? colorOf(from) : "#dbe4ee";
        return (
          <Line
            key={`${slot}:${from}:${to}`}
            points={[a.canvasX, a.canvasY, b.canvasX, b.canvasY]}
            stroke={color}
            strokeWidth={2.2}
            strokeScaleEnabled={false}
            opacity={0.85}
            listening={false}
          />
        );
      }))}
    </Layer>
  );
});
