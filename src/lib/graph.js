// Pure helpers for the dependency graph. No Supabase or React in here,
// so they're easy to test on their own.

export const NODE_W = 210;
export const NODE_H = 96;
export const ROW_GAP = 160; // vertical distance between a task and its prerequisite

export const TYPE_LABEL = {
  task: 'Task',
  uncertainty: 'Uncertainty',
  milestone: 'Milestone',
  safety: 'Safety gate',
};

export const STATUS_LABEL = { done: 'Done', ready: 'Ready', blocked: 'Blocked' };

/**
 * For every task: its status and its direct prerequisites / dependents.
 *   done    - marked complete
 *   ready   - not done, and every prerequisite is done (or it has none)
 *   blocked - not done, and at least one prerequisite isn't
 */
export function analyse(tasks, dependencies) {
  const info = new Map(tasks.map((t) => [t.id, { prerequisites: [], dependents: [], status: 'ready' }]));
  for (const d of dependencies) {
    info.get(d.dependent_id)?.prerequisites.push(d.prerequisite_id);
    info.get(d.prerequisite_id)?.dependents.push(d.dependent_id);
  }
  const done = new Set(tasks.filter((t) => t.completed_at).map((t) => t.id));
  for (const t of tasks) {
    const i = info.get(t.id);
    if (done.has(t.id)) i.status = 'done';
    else if (i.prerequisites.every((p) => done.has(p))) i.status = 'ready';
    else i.status = 'blocked';
  }
  return info;
}

/** Every task that `id` depends on, directly or indirectly (including itself). */
export function upstreamOf(id, dependencies) {
  const seen = new Set();
  const queue = [id];
  while (queue.length) {
    const v = queue.shift();
    if (seen.has(v)) continue;
    seen.add(v);
    for (const d of dependencies) if (d.dependent_id === v) queue.push(d.prerequisite_id);
  }
  return seen;
}

/** Quick client-side check so the user gets instant feedback. The database checks again. */
export function wouldCreateCycle(dependencies, prerequisiteId, dependentId) {
  if (prerequisiteId === dependentId) return true;
  return upstreamOf(prerequisiteId, dependencies).has(dependentId);
}

function overlaps(tasks, x, y, skip) {
  return tasks.some(
    (t) => !skip.has(t.id) && Math.abs(t.x - x) < NODE_W + 30 && Math.abs(t.y - y) < NODE_H + 30,
  );
}

/** The nearest free spot to (x, y), preferring to slide sideways so rows stay rows. */
export function placeNear(tasks, x, y, skip = new Set()) {
  if (!overlaps(tasks, x, y, skip)) return { x, y };
  const step = NODE_W + 40;
  for (let i = 1; i <= 10; i++) {
    for (const dx of [i * step, -i * step]) {
      if (!overlaps(tasks, x + dx, y, skip)) return { x: x + dx, y };
    }
  }
  return { x, y: y + ROW_GAP };
}

/**
 * Where a new task should go, plus any existing tasks that need to move to make
 * room. Prerequisites sit below the tasks they unlock.
 *
 * context.mode: 'independent' | 'prerequisite' | 'dependent' | 'insert'
 * Returns { position: {x, y}, moves: [{ id, x, y }] }
 */
export function layoutForNewTask(context, tasks, dependencies) {
  const byId = new Map(tasks.map((t) => [t.id, t]));

  if (context.mode === 'prerequisite') {
    const t = byId.get(context.targetId);
    return { position: placeNear(tasks, t.x, t.y + ROW_GAP), moves: [] };
  }

  if (context.mode === 'dependent') {
    const t = byId.get(context.targetId);
    return { position: placeNear(tasks, t.x, t.y - ROW_GAP), moves: [] };
  }

  if (context.mode === 'insert') {
    const below = byId.get(context.prerequisiteId);
    const above = byId.get(context.dependentId);
    // Make room for two rows: push the prerequisite and everything under it down.
    const needed = 2 * ROW_GAP - (below.y - above.y);
    let moves = [];
    let working = tasks;
    if (needed > 0) {
      const chain = upstreamOf(below.id, dependencies);
      moves = tasks.filter((t) => chain.has(t.id)).map((t) => ({ id: t.id, x: t.x, y: t.y + needed }));
      const moved = new Map(moves.map((m) => [m.id, m]));
      working = tasks.map((t) => (moved.has(t.id) ? { ...t, ...moved.get(t.id) } : t));
    }
    const newBelow = working.find((t) => t.id === below.id);
    const x = Math.round((newBelow.x + above.x) / 2);
    const y = Math.round((newBelow.y + above.y) / 2);
    return { position: placeNear(working, x, y), moves };
  }

  const { x, y } = context.position ?? { x: 0, y: 0 };
  return { position: placeNear(tasks, Math.round(x), Math.round(y)), moves: [] };
}

export function initials(name = '') {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join('');
}
