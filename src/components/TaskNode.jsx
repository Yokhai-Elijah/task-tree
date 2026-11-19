import { memo } from 'react';
import { Handle, NodeToolbar, Position } from '@xyflow/react';
import { STATUS_LABEL, TYPE_LABEL, initials } from '../lib/graph.js';

// Handles: drag from the TOP dot of a prerequisite to the BOTTOM dot of the task
// it unlocks (or the other way round). React Flow always reports it as
// source = prerequisite, target = dependent, so direction can't get mixed up.
function TaskNode({ data, selected }) {
  const { task, status, prerequisiteCount, assignees, onAdd } = data;
  return (
    <>
      {/* On the right so it never covers the lines above and below the task. */}
      <NodeToolbar isVisible={selected} position={Position.Right} offset={12} className="node-actions">
        <button className="toolbar-button" onClick={() => onAdd({ mode: 'dependent', targetId: task.id })}>
          ↑ Next task
        </button>
        <button className="toolbar-button" onClick={() => onAdd({ mode: 'prerequisite', targetId: task.id })}>
          ↓ Prerequisite
        </button>
      </NodeToolbar>

      <Handle type="source" position={Position.Top} className="handle" title="Drag to the task this unlocks" />

      <div className={`task-node type-${task.type} status-${status} ${selected ? 'is-selected' : ''}`}>
        <div className="task-node-tag">
          #{task.id} · {TYPE_LABEL[task.type] ?? task.type}
          {task.workstream ? ` · ${task.workstream}` : ''}
        </div>
        <div className="task-node-title">{task.title}</div>
        <div className="task-node-foot">
          <span className={`status-pill ${status}`}>{STATUS_LABEL[status]}</span>
          {prerequisiteCount > 0 && status === 'blocked' && (
            <span className="muted small">{prerequisiteCount} prereq</span>
          )}
          <span className="avatars">
            {assignees.slice(0, 3).map((p) => (
              <span key={p.id} className="avatar" title={p.name}>
                {initials(p.name)}
              </span>
            ))}
            {assignees.length > 3 && <span className="avatar">+{assignees.length - 3}</span>}
          </span>
        </div>
      </div>

      <Handle type="target" position={Position.Bottom} className="handle" title="Drag to a prerequisite" />

    </>
  );
}

export default memo(TaskNode);
