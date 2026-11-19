import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Background,
  Controls,
  MarkerType,
  MiniMap,
  Panel,
  ReactFlow,
  useNodesState,
  useReactFlow,
} from '@xyflow/react';
import TaskNode from './TaskNode.jsx';
import DependencyEdge from './DependencyEdge.jsx';
import { NODE_H, NODE_W, wouldCreateCycle } from '../lib/graph.js';
import { addDependency, moveTasks, removeDependency } from '../lib/actions.js';
import { useToast } from '../lib/toast.jsx';

const nodeTypes = { task: TaskNode };
const edgeTypes = { dependency: DependencyEdge };

const MINIMAP_COLOURS = { done: '#3c5a52', ready: '#55ceb2', blocked: '#e6a862' };

export default function TaskTree({ data, analysis, profilesById, selectedId, onSelect, onNewTask, focus, run }) {
  const toast = useToast();
  const { screenToFlowPosition, setCenter } = useReactFlow();
  const wrapper = useRef(null);
  const dragging = useRef(new Set());
  const [selectedEdge, setSelectedEdge] = useState(null);
  const [filter, setFilter] = useState('all');

  const assigneesByTask = useMemo(() => {
    const map = new Map();
    for (const a of data.task_assignees) {
      const p = profilesById.get(a.user_id);
      if (!p) continue;
      if (!map.has(a.task_id)) map.set(a.task_id, []);
      map.get(a.task_id).push(p);
    }
    return map;
  }, [data.task_assignees, profilesById]);

  const onInsert = useCallback(
    (prerequisiteId, dependentId) => onNewTask({ mode: 'insert', prerequisiteId, dependentId }),
    [onNewTask],
  );

  const onRemove = useCallback(
    (prerequisiteId, dependentId) => {
      const a = data.tasks.find((t) => t.id === prerequisiteId)?.title;
      const b = data.tasks.find((t) => t.id === dependentId)?.title;
      if (!window.confirm(`Remove the dependency "${a}" → "${b}"? Both tasks stay.`)) return;
      setSelectedEdge(null);
      run(() => removeDependency(prerequisiteId, dependentId), 'Dependency removed.');
    },
    [data.tasks, run],
  );

  // Nodes live in local state so dragging is smooth; they're re-synced from the
  // database whenever it changes, except for whatever is being dragged right now.
  const [nodes, setNodes, onNodesChange] = useNodesState([]);

  useEffect(() => {
    setNodes((prev) => {
      const prevById = new Map(prev.map((n) => [n.id, n]));
      return data.tasks.map((task) => {
        const id = String(task.id);
        const old = prevById.get(id);
        const info = analysis.get(task.id);
        const dimmed = filter !== 'all' && info?.status !== filter;
        return {
          id,
          type: 'task',
          position: old && dragging.current.has(id) ? old.position : { x: task.x, y: task.y },
          selected: task.id === selectedId,
          className: dimmed ? 'dimmed' : '',
          width: NODE_W,
          height: NODE_H,
          data: {
            task,
            status: info?.status ?? 'ready',
            prerequisiteCount: info?.prerequisites.length ?? 0,
            assignees: assigneesByTask.get(task.id) ?? [],
            onAdd: onNewTask,
          },
        };
      });
    });
  }, [data.tasks, analysis, assigneesByTask, selectedId, filter, onNewTask, setNodes]);

  const edges = useMemo(
    () =>
      data.dependencies.map((d) => {
        const id = `${d.prerequisite_id}-${d.dependent_id}`;
        const highlighted = d.prerequisite_id === selectedId || d.dependent_id === selectedId;
        const colour = highlighted ? '#58cfb5' : '#4d6f88';
        return {
          id,
          type: 'dependency',
          source: String(d.prerequisite_id),
          target: String(d.dependent_id),
          selected: id === selectedEdge,
          markerEnd: { type: MarkerType.ArrowClosed, color: colour, width: 18, height: 18 },
          style: { stroke: colour, strokeWidth: highlighted ? 2.5 : 1.75 },
          data: { prerequisiteId: d.prerequisite_id, dependentId: d.dependent_id, highlighted, onInsert, onRemove },
        };
      }),
    [data.dependencies, selectedId, selectedEdge, onInsert, onRemove],
  );

  // Centre on a task when asked (e.g. opened from "My tasks").
  useEffect(() => {
    if (!focus) return;
    const t = data.tasks.find((x) => x.id === focus.id);
    if (t) setCenter(t.x + NODE_W / 2, t.y + NODE_H / 2, { zoom: 1, duration: 400 });
    // Only when a new focus request arrives.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus]);

  const onConnect = useCallback(
    ({ source, target }) => {
      const prerequisiteId = Number(source);
      const dependentId = Number(target);
      if (wouldCreateCycle(data.dependencies, prerequisiteId, dependentId)) {
        toast('That would create a loop: those tasks would wait on each other.', 'error');
        return;
      }
      if (data.dependencies.some((d) => d.prerequisite_id === prerequisiteId && d.dependent_id === dependentId)) {
        toast('That dependency already exists.', 'error');
        return;
      }
      run(() => addDependency(prerequisiteId, dependentId), 'Dependency added.');
    },
    [data.dependencies, run, toast],
  );

  const onNodeDragStart = useCallback((_e, _node, dragged) => {
    for (const n of dragged) dragging.current.add(n.id);
  }, []);

  const onNodeDragStop = useCallback(
    (_e, _node, dragged) => {
      const moves = dragged
        .map((n) => ({ id: Number(n.id), x: n.position.x, y: n.position.y }))
        .filter((m) => {
          const t = data.tasks.find((x) => x.id === m.id);
          return t && (Math.round(t.x) !== Math.round(m.x) || Math.round(t.y) !== Math.round(m.y));
        });
      const finish = () => {
        for (const n of dragged) dragging.current.delete(n.id);
      };
      if (!moves.length) return finish();
      run(() => moveTasks(moves)).finally(finish);
      return undefined;
    },
    [data.tasks, run],
  );

  function newIndependentTask() {
    const rect = wrapper.current.getBoundingClientRect();
    const centre = screenToFlowPosition({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 });
    onNewTask({ mode: 'independent', position: { x: centre.x - NODE_W / 2, y: centre.y - NODE_H / 2 } });
  }

  const counts = useMemo(() => {
    const c = { ready: 0, blocked: 0, done: 0 };
    for (const i of analysis.values()) c[i.status]++;
    return c;
  }, [analysis]);

  return (
    <div className="canvas" ref={wrapper}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodesChange={onNodesChange}
        onNodeClick={(_e, node) => {
          setSelectedEdge(null);
          onSelect(Number(node.id));
        }}
        onEdgeClick={(_e, edge) => setSelectedEdge(edge.id)}
        onPaneClick={() => {
          setSelectedEdge(null);
          onSelect(null);
        }}
        onConnect={onConnect}
        onNodeDragStart={onNodeDragStart}
        onNodeDragStop={onNodeDragStop}
        deleteKeyCode={null}
        snapToGrid
        snapGrid={[10, 10]}
        minZoom={0.2}
        maxZoom={1.75}
        fitView
        fitViewOptions={{ padding: 0.15 }}
        forceColorMode="dark"
      >
        <Background gap={24} size={1.2} />
        <Controls showInteractive={false} />
        <MiniMap
          pannable
          zoomable
          nodeColor={(n) => MINIMAP_COLOURS[n.data?.status] ?? '#49617a'}
          maskColor="rgba(11, 17, 32, 0.7)"
        />
        <Panel position="top-left" className="canvas-bar">
          <span className="canvas-title">Dependency tree</span>
          <div className="filters" role="group" aria-label="Highlight by status">
            {[
              ['all', `All ${data.tasks.length}`],
              ['ready', `Ready ${counts.ready}`],
              ['blocked', `Blocked ${counts.blocked}`],
              ['done', `Done ${counts.done}`],
            ].map(([key, label]) => (
              <button
                key={key}
                className={`filter ${filter === key ? 'active' : ''} f-${key}`}
                aria-pressed={filter === key}
                onClick={() => setFilter(key)}
              >
                {label}
              </button>
            ))}
          </div>
        </Panel>
        <Panel position="top-right">
          <button className="primary" onClick={newIndependentTask}>
            + New task
          </button>
        </Panel>
      </ReactFlow>
    </div>
  );
}
