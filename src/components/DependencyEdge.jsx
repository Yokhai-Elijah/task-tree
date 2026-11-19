import { BaseEdge, EdgeLabelRenderer, getBezierPath } from '@xyflow/react';

// A dependency line. When it's selected (click it) or touches the selected task,
// it shows "+" to insert a task in the middle and "×" to remove the link.
export default function DependencyEdge(props) {
  const { id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, markerEnd, style, selected, data } =
    props;
  const [path, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  });
  const showActions = selected || data.highlighted;

  return (
    <>
      <BaseEdge id={id} path={path} markerEnd={markerEnd} style={style} interactionWidth={24} />
      {showActions && (
        <EdgeLabelRenderer>
          <div
            className="edge-actions nodrag nopan"
            style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` }}
          >
            <button
              className="edge-button insert"
              title="Insert a task between these two"
              aria-label="Insert a task between these two"
              onClick={() => data.onInsert(data.prerequisiteId, data.dependentId)}
            >
              +
            </button>
            <button
              className="edge-button remove"
              title="Remove this dependency"
              aria-label="Remove this dependency"
              onClick={() => data.onRemove(data.prerequisiteId, data.dependentId)}
            >
              ×
            </button>
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}
