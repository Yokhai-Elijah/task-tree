import { STATUS_LABEL, TYPE_LABEL } from '../lib/graph.js';
import { assign } from '../lib/actions.js';

export default function MyTasks({ data, analysis, me, onOpen, run }) {
  const tasksById = new Map(data.tasks.map((t) => [t.id, t]));
  const mineIds = new Set(data.task_assignees.filter((a) => a.user_id === me.id).map((a) => a.task_id));
  const assigned = new Set(data.task_assignees.map((a) => a.task_id));
  const mine = [...mineIds].map((id) => tasksById.get(id)).filter(Boolean);

  const group = (status) => mine.filter((t) => analysis.get(t.id)?.status === status);
  const openForPickup = data.tasks.filter((t) => !assigned.has(t.id) && analysis.get(t.id)?.status === 'ready');

  return (
    <main className="mine-page">
      <div className="mine-inner">
        <h1>My tasks</h1>
        <p className="muted">Tasks assigned to you. "Ready" means everything they wait on is done.</p>

        <Group title="Ready to work on" tasks={group('ready')} analysis={analysis} tasksById={tasksById} onOpen={onOpen}
          empty="Nothing ready right now." />
        <Group title="Blocked" tasks={group('blocked')} analysis={analysis} tasksById={tasksById} onOpen={onOpen}
          empty="Nothing blocked." showBlockers />
        <Group title="Done" tasks={group('done')} analysis={analysis} tasksById={tasksById} onOpen={onOpen}
          empty="Nothing completed yet." />

        <h2 className="group-title">Unassigned and ready</h2>
        <p className="muted small">Nobody has these yet. Pick one up.</p>
        {openForPickup.length === 0 && <p className="empty-note">None.</p>}
        <ul className="card-list">
          {openForPickup.map((t) => (
            <li key={t.id} className="task-card">
              <button className="task-card-main" onClick={() => onOpen(t.id)}>
                <span className="eyebrow">#{t.id} · {TYPE_LABEL[t.type]}{t.workstream && ` · ${t.workstream}`}</span>
                <span className="task-card-title">{t.title}</span>
              </button>
              <button className="small-button" onClick={() => run(() => assign(t.id, me.id), "You're on it.")}>
                Take it
              </button>
            </li>
          ))}
        </ul>
      </div>
    </main>
  );
}

function Group({ title, tasks, analysis, tasksById, onOpen, empty, showBlockers }) {
  return (
    <>
      <h2 className="group-title">
        {title} <span className="muted">({tasks.length})</span>
      </h2>
      {tasks.length === 0 && <p className="empty-note">{empty}</p>}
      <ul className="card-list">
        {tasks.map((t) => {
          const info = analysis.get(t.id);
          const blockers = showBlockers
            ? info.prerequisites.map((id) => tasksById.get(id)).filter((p) => p && !p.completed_at)
            : [];
          return (
            <li key={t.id} className="task-card">
              <button className="task-card-main" onClick={() => onOpen(t.id)}>
                <span className="eyebrow">#{t.id} · {TYPE_LABEL[t.type]}{t.workstream && ` · ${t.workstream}`}</span>
                <span className="task-card-title">{t.title}</span>
                {blockers.length > 0 && (
                  <span className="muted small">Waiting on: {blockers.map((b) => b.title).join(', ')}</span>
                )}
              </button>
              <span className={`status-pill ${info.status}`}>{STATUS_LABEL[info.status]}</span>
            </li>
          );
        })}
      </ul>
    </>
  );
}
