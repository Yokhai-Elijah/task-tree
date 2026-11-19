import { useState } from 'react';
import { STATUS_LABEL, TYPE_LABEL } from '../lib/graph.js';
import {
  addLink,
  assign,
  deleteTask,
  removeLink,
  setCompleted,
  unassign,
  updateTask,
} from '../lib/actions.js';
import Discussion from './Discussion.jsx';

export default function TaskPanel({ task, data, analysis, profilesById, me, onSelect, onClose, onNewTask, run }) {
  const info = analysis.get(task.id);
  const isLead = me.role !== 'member';
  const assigneeIds = data.task_assignees.filter((a) => a.task_id === task.id).map((a) => a.user_id);
  const isAssignee = assigneeIds.includes(me.id);
  const canComplete = isLead || isAssignee || assigneeIds.length === 0;
  const links = data.task_links.filter((l) => l.task_id === task.id);
  const tasksById = new Map(data.tasks.map((t) => [t.id, t]));
  const completedBy = profilesById.get(task.completed_by);

  function toggleComplete() {
    const done = !task.completed_at;
    if (done && info.status === 'blocked') {
      const open = info.prerequisites.filter((id) => !tasksById.get(id)?.completed_at).map((id) => tasksById.get(id)?.title);
      if (!window.confirm(`These prerequisites aren't done yet:\n\n• ${open.join('\n• ')}\n\nMark complete anyway?`)) return;
    }
    run(() => setCompleted(task.id, done), done ? 'Marked complete.' : 'Reopened.');
  }

  function remove() {
    if (!window.confirm(`Delete "${task.title}" with its links and discussion? Connected lines are removed too.`)) return;
    run(async () => {
      await deleteTask(task.id);
      onClose();
    }, 'Task deleted.');
  }

  return (
    <aside className="panel" aria-label="Task details">
      <div className="panel-head">
        <div className="eyebrow">
          #{task.id} · {TYPE_LABEL[task.type]}
          {task.workstream && ` · ${task.workstream}`}
        </div>
        <button className="icon-button" onClick={onClose} aria-label="Close panel">
          ×
        </button>
      </div>

      <div className="panel-body">
        <h2 className="panel-title">{task.title}</h2>
        <div className="row wrap">
          <span className={`status-pill ${info.status}`}>{STATUS_LABEL[info.status]}</span>
          {task.completed_at && (
            <span className="muted small">
              by {completedBy?.name ?? 'someone'} · {new Date(task.completed_at).toLocaleDateString()}
            </span>
          )}
        </div>

        <button
          className={`wide ${task.completed_at ? '' : 'primary'}`}
          onClick={toggleComplete}
          disabled={!canComplete}
          title={canComplete ? '' : 'Only assignees or a lead can change this'}
        >
          {task.completed_at ? '↶ Reopen task' : '✓ Mark complete'}
        </button>

        <Section title="Assigned to">
          <Assignees task={task} assigneeIds={assigneeIds} profilesById={profilesById} data={data} me={me} isLead={isLead} run={run} />
        </Section>

        <Section title={`Waiting on (${info.prerequisites.length})`}>
          {info.prerequisites.length === 0 && <p className="muted small">Nothing. This can start any time.</p>}
          <TaskLinks ids={info.prerequisites} tasksById={tasksById} analysis={analysis} onSelect={onSelect} />
          <button className="small-button" onClick={() => onNewTask({ mode: 'prerequisite', targetId: task.id })}>
            + Add prerequisite
          </button>
        </Section>

        <Section title={`Unlocks (${info.dependents.length})`}>
          <TaskLinks ids={info.dependents} tasksById={tasksById} analysis={analysis} onSelect={onSelect} />
          <button className="small-button" onClick={() => onNewTask({ mode: 'dependent', targetId: task.id })}>
            + Add next task
          </button>
        </Section>

        <Section title="Links & leads">
          <Links taskId={task.id} links={links} profilesById={profilesById} me={me} isLead={isLead} run={run} />
        </Section>

        <Section title="Details">
          <Details task={task} run={run} />
        </Section>

        <Section title="Discussion">
          <Discussion taskId={task.id} profilesById={profilesById} me={me} />
        </Section>

        {isLead && (
          <div className="danger-zone">
            <button className="danger wide" onClick={remove}>
              Delete task
            </button>
          </div>
        )}
      </div>
    </aside>
  );
}

function Section({ title, children }) {
  return (
    <section className="section">
      <h3>{title}</h3>
      {children}
    </section>
  );
}

function TaskLinks({ ids, tasksById, analysis, onSelect }) {
  if (!ids.length) return null;
  return (
    <ul className="task-list">
      {ids.map((id) => {
        const t = tasksById.get(id);
        if (!t) return null;
        const status = analysis.get(id)?.status;
        return (
          <li key={id}>
            <button className="task-link" onClick={() => onSelect(id)}>
              <span className={`dot ${status}`} aria-label={STATUS_LABEL[status]} />
              {t.title}
            </button>
          </li>
        );
      })}
    </ul>
  );
}

function Assignees({ task, assigneeIds, profilesById, data, me, isLead, run }) {
  const [adding, setAdding] = useState('');
  const others = data.profiles.filter((p) => !assigneeIds.includes(p.id)).sort((a, b) => a.name.localeCompare(b.name));

  return (
    <>
      <div className="chips">
        {assigneeIds.length === 0 && <span className="muted small">Nobody yet. Anyone can complete it.</span>}
        {assigneeIds.map((id) => {
          const p = profilesById.get(id);
          const canRemove = isLead || id === me.id;
          return (
            <span className="chip" key={id}>
              {p?.name ?? 'Unknown'}
              {canRemove && (
                <button
                  className="chip-x"
                  aria-label={`Remove ${p?.name}`}
                  onClick={() => run(() => unassign(task.id, id))}
                >
                  ×
                </button>
              )}
            </span>
          );
        })}
      </div>
      <div className="row">
        {!assigneeIds.includes(me.id) && (
          <button className="small-button" onClick={() => run(() => assign(task.id, me.id), "You're on it.")}>
            + Assign me
          </button>
        )}
        {isLead && others.length > 0 && (
          <select
            value={adding}
            aria-label="Assign someone"
            onChange={(e) => {
              const id = e.target.value;
              setAdding('');
              if (id) run(() => assign(task.id, id), 'Assigned.');
            }}
          >
            <option value="">Assign someone…</option>
            {others.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        )}
      </div>
    </>
  );
}

function hostOf(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

function Links({ taskId, links, profilesById, me, isLead, run }) {
  const [label, setLabel] = useState('');
  const [url, setUrl] = useState('');
  const [error, setError] = useState('');

  async function submit(e) {
    e.preventDefault();
    let clean = url.trim();
    if (clean && !/^https?:\/\//i.test(clean)) clean = `https://${clean}`;
    try {
      new URL(clean);
    } catch {
      setError('Enter a full web address.');
      return;
    }
    setError('');
    const ok = await run(async () => {
      await addLink(taskId, label.trim(), clean);
      return true;
    }, 'Link added.');
    if (ok) {
      setLabel('');
      setUrl('');
    }
  }

  return (
    <>
      {links.length === 0 && <p className="muted small">No links yet: Drive folders, datasheets, supplier quotes, contacts…</p>}
      <ul className="link-list">
        {links.map((l) => (
          <li key={l.id}>
            <a href={l.url} target="_blank" rel="noopener noreferrer">
              {l.label || hostOf(l.url)}
            </a>
            <span className="muted small"> · {profilesById.get(l.added_by)?.name ?? 'someone'}</span>
            {(l.added_by === me.id || isLead) && (
              <button className="icon-button" aria-label="Remove link" onClick={() => run(() => removeLink(l.id))}>
                ×
              </button>
            )}
          </li>
        ))}
      </ul>
      <form className="stack tight" onSubmit={submit}>
        <input value={label} onChange={(e) => setLabel(e.target.value)} maxLength={120} placeholder="Label (optional)" />
        <div className="row">
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://…"
            aria-label="Link address"
            required
          />
          <button type="submit">Add</button>
        </div>
        {error && <p className="form-error">{error}</p>}
      </form>
    </>
  );
}

function Details({ task, run }) {
  const [draft, setDraft] = useState({
    title: task.title,
    type: task.type,
    workstream: task.workstream,
    description: task.description,
  });
  const dirty = ['title', 'type', 'workstream', 'description'].some((k) => draft[k] !== task[k]);
  const set = (k) => (e) => setDraft((d) => ({ ...d, [k]: e.target.value }));

  function save(e) {
    e.preventDefault();
    if (!draft.title.trim()) return;
    run(() => updateTask(task.id, { ...draft, title: draft.title.trim(), workstream: draft.workstream.trim() }), 'Saved.');
  }

  return (
    <form className="stack tight" onSubmit={save}>
      <label>
        Title
        <input value={draft.title} onChange={set('title')} maxLength={140} required />
      </label>
      <div className="row">
        <label>
          Kind
          <select value={draft.type} onChange={set('type')}>
            {Object.entries(TYPE_LABEL).map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
        </label>
        <label>
          Workstream
          <input value={draft.workstream} onChange={set('workstream')} maxLength={60} placeholder="e.g. Plumbing" />
        </label>
      </div>
      <label>
        Description
        <textarea value={draft.description} onChange={set('description')} maxLength={4000} rows={3} />
      </label>
      {dirty && (
        <button type="submit" className="primary">
          Save details
        </button>
      )}
    </form>
  );
}
