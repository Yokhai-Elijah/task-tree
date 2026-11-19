import { useEffect, useRef, useState } from 'react';
import { TYPE_LABEL, layoutForNewTask } from '../lib/graph.js';
import { createTask, insertTaskBetween, moveTasks } from '../lib/actions.js';

export default function NewTaskDialog({ context, data, onClose, onCreated, run }) {
  const dialog = useRef(null);
  const [title, setTitle] = useState('');
  const [type, setType] = useState('task');
  const [busy, setBusy] = useState(false);
  const titleOf = (id) => data.tasks.find((t) => t.id === id)?.title ?? 'that task';

  useEffect(() => {
    dialog.current.showModal();
  }, []);

  const heading = {
    independent: 'New task',
    prerequisite: 'Add prerequisite',
    dependent: 'Add next task',
    insert: 'Insert task',
  }[context.mode];

  const help = {
    independent: 'Creates an unconnected task. Drag between the dots on tasks to connect it.',
    prerequisite: `This must be done before "${titleOf(context.targetId)}".`,
    dependent: `This can start once "${titleOf(context.targetId)}" is done.`,
    insert: `Goes between "${titleOf(context.prerequisiteId)}" and "${titleOf(context.dependentId)}".`,
  }[context.mode];

  async function submit(e) {
    e.preventDefault();
    const clean = title.trim();
    if (!clean || busy) return;
    setBusy(true);
    const { position, moves } = layoutForNewTask(context, data.tasks, data.dependencies);

    const task = await run(async () => {
      if (context.mode === 'insert') {
        if (moves.length) await moveTasks(moves);
        return insertTaskBetween({
          prerequisiteId: context.prerequisiteId,
          dependentId: context.dependentId,
          title: clean,
          type,
          position,
        });
      }
      return createTask({
        title: clean,
        type,
        position,
        prerequisiteOf: context.mode === 'prerequisite' ? context.targetId : null,
        dependentOf: context.mode === 'dependent' ? context.targetId : null,
      });
    }, 'Task created.');

    setBusy(false);
    if (task) onCreated(task);
  }

  return (
    <dialog ref={dialog} className="dialog" onClose={onClose} aria-labelledby="new-task-heading">
      <form onSubmit={submit} className="stack">
        <h2 id="new-task-heading">{heading}</h2>
        <p className="muted small">{help}</p>
        <label>
          Task name
          <input
            autoFocus
            required
            maxLength={140}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Name this engineering task"
          />
        </label>
        <label>
          Kind
          <select value={type} onChange={(e) => setType(e.target.value)}>
            {Object.entries(TYPE_LABEL).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <div className="row end">
          <button type="button" onClick={() => dialog.current.close()}>
            Cancel
          </button>
          <button type="submit" className="primary" disabled={busy || !title.trim()}>
            {busy ? 'Adding…' : 'Add task'}
          </button>
        </div>
      </form>
    </dialog>
  );
}
