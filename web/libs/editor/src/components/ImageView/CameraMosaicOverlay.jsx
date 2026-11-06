import React from "react";
import { observer } from "mobx-react";
import { Layer, Line } from "react-konva";
import { normalizeJoint } from "../Skeleton3D/adapter";
import { colorOf, standardEdges, sideOf } from "../Skeleton3D/topology";

/**
 * Read-only decoration of the single 2x2 source mosaic.
 *
 * The Konva canvas is still the original Label Studio image, so points can
 * be dragged, selected, undone and saved as before. The overlay only draws
 * implicit skeleton links not already represented by a
 * user-created Relation. It never creates or changes annotations.
 */
export const CameraMosaicOverlay = observer(({ item }) => {
  const image = item.currentImageEntity;
  const width = image?.naturalWidth * item.stageZoom;
  const height = image?.naturalHeight * item.stageZoom;
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null;

  const regions = item.regs.filter((region) => region.type === "keypointregion" && !region.hidden);
  const cells = Array.from({ length: 4 }, () => new Map());
  for (const region of regions) {
    if (![region.x, region.y, region.canvasX, region.canvasY].every(Number.isFinite)) continue;
    const slot = (region.y >= 50 ? 2 : 0) + (region.x >= 50 ? 1 : 0);
    const joint = region.labels?.length === 1 ? normalizeJoint(region.labels[0]) : "";
    if (!joint) continue;
    if (!cells[slot].has(joint)) cells[slot].set(joint, region);
  }

  const existing = new Set();
  const relations = item.annotation?.relationStore?.relations ?? [];
  for (const relation of relations) {
    if (!relation.node1 || !relation.node2) continue;
    existing.add([relation.node1.id, relation.node2.id].sort().join("|"));
  }

  return (
    <Layer listening={false}>
      {/* Only skeleton lines and thin mosaic dividers. Camera title banners
          removed: they occluded annotations and are not required for editing. */}
      <Line points={[width / 2, 0, width / 2, height]} stroke="#263142" strokeWidth={2} strokeScaleEnabled={false} />
      <Line points={[0, height / 2, width, height / 2]} stroke="#263142" strokeWidth={2} strokeScaleEnabled={false} />
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
