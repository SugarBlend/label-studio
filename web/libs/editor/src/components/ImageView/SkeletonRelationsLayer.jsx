import { observer } from "mobx-react";
import { Layer, Line } from "react-konva";

/**
 * Renders manually-created Relations between two KeyPointLabels regions as
 * straight "skeleton" edges, directly inside the Konva Stage (same layer
 * tree as the points themselves).
 *
 * WHY THIS EXISTS (instead of relying on the generic SVG RelationsOverlay):
 * The generic overlay lives outside the Stage, positioned over the whole
 * app with an absolutely-positioned <svg>. To support relations between any
 * region type (text spans, audio segments, rectangles, etc. — things with
 * no reactive x/y) it measures each region's real screen position via
 * `getBoundingClientRect()` and is throttled by two chained debounces
 * (10ms in PropertyWatcher + 50ms in NodesConnector) so it doesn't
 * re-measure the DOM on every animation frame. That's invisible for
 * discrete edits, but during a smooth pan/zoom gesture it makes the arrows
 * visibly trail behind the points, which move via Konva's own instant,
 * reactive `canvasX`/`canvasY` getters with zero debounce.
 *
 * This layer reads those exact same reactive getters (the ones the
 * <Circle> in KeyPointRegion.jsx uses) inside a mobx `observer`, so it
 * re-renders on the very same tick as the points — no DOM reads, no
 * debounce, no lag, at any zoom level or pan speed.
 *
 * The relations themselves are still created the normal way (select a
 * point, press R, click a second point) — this only changes how
 * keypoint-to-keypoint relations are drawn once created. RelationsOverlay
 * skips these relations entirely (see the filter in its renderRelations)
 * so there is no laggy duplicate underneath this one. All other relation
 * types (text, rectangles, etc.) keep rendering through the original SVG
 * overlay, untouched.
 */
const isKeypointRegion = (region) => region?.type === "keypointregion";

const SkeletonRelationsLayer = observer(({ item }) => {
  const annotation = item.annotation;

  if (!annotation) return null;

  const relationStore = annotation.relationStore;

  if (!relationStore || !relationStore.showConnections) return null;

  const relations = relationStore.relations.filter(
    (r) => r.visible && r.shouldRender && isKeypointRegion(r.node1) && isKeypointRegion(r.node2),
  );

  if (relations.length === 0) return null;

  const highlighted = relationStore.highlighted;

  const lines = relations.map((relation) => {
    const { node1, node2 } = relation;

    if (node1.hidden || node2.hidden) return null;
    if (!node1.inViewPort || !node2.inViewPort) return null;

    const isHighlighted = highlighted === relation;
    const dimmed = !!highlighted && !isHighlighted;

    return (
      <Line
        key={relation.id}
        points={[node1.canvasX, node1.canvasY, node2.canvasX, node2.canvasY]}
        stroke={isHighlighted ? "#fa541c" : "#00E5FF"}
        strokeWidth={isHighlighted ? 3 : 2}
        strokeScaleEnabled={false}
        opacity={dimmed ? 0.2 : 1}
        listening={false}
        perfectDrawEnabled={false}
      />
    );
  });

  return <Layer listening={false}>{lines}</Layer>;
});

export { SkeletonRelationsLayer, isKeypointRegion };
