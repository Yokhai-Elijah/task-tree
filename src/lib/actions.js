// Every write to the database goes through here, so error handling is in one place.
// Each function throws an Error with a message that's safe to show the user.

import { supabase } from './supabase.js';

function friendly(error) {
  if (!error) return 'Something went wrong.';
  if (error.code === '23505') return 'That already exists.';
  if (error.code === '42501') return "You don't have permission to do that.";
  if (error.code === '23514') return 'That value is not allowed (check its length or format).';
  // Messages raised by our own database triggers are already written for people.
  return error.message || 'Something went wrong.';
}

function check({ data, error }) {
  if (error) throw new Error(friendly(error));
  return data;
}

// RLS makes a forbidden update/delete affect zero rows rather than error, so we
// ask for the affected rows back and complain if there are none.
function expectRows(result, message) {
  const rows = check(result);
  if (!rows || rows.length === 0) throw new Error(message);
  return rows;
}

export async function createTask({ title, type, position, prerequisiteOf = null, dependentOf = null }) {
  return check(
    await supabase.rpc('create_task', {
      p_title: title,
      p_type: type,
      p_x: position.x,
      p_y: position.y,
      p_prerequisite_of: prerequisiteOf,
      p_dependent_of: dependentOf,
    }),
  );
}

export async function insertTaskBetween({ prerequisiteId, dependentId, title, type, position }) {
  return check(
    await supabase.rpc('insert_task_between', {
      p_prerequisite_id: prerequisiteId,
      p_dependent_id: dependentId,
      p_title: title,
      p_type: type,
      p_x: position.x,
      p_y: position.y,
    }),
  );
}

export async function updateTask(id, fields) {
  return expectRows(
    await supabase.from('tasks').update(fields).eq('id', id).select(),
    'That task could not be updated. It may have been deleted.',
  );
}

export async function moveTasks(moves) {
  await Promise.all(
    moves.map(async (m) =>
      check(await supabase.from('tasks').update({ x: Math.round(m.x), y: Math.round(m.y) }).eq('id', m.id)),
    ),
  );
}

export async function setCompleted(id, done) {
  // The server replaces this timestamp with its own and records who did it.
  return updateTask(id, { completed_at: done ? new Date().toISOString() : null });
}

export async function deleteTask(id) {
  return expectRows(
    await supabase.from('tasks').delete().eq('id', id).select('id'),
    'Only leads can delete tasks.',
  );
}

export async function addDependency(prerequisiteId, dependentId) {
  return check(
    await supabase.from('dependencies').insert({ prerequisite_id: prerequisiteId, dependent_id: dependentId }),
  );
}

export async function removeDependency(prerequisiteId, dependentId) {
  return expectRows(
    await supabase
      .from('dependencies')
      .delete()
      .match({ prerequisite_id: prerequisiteId, dependent_id: dependentId })
      .select(),
    'That dependency no longer exists.',
  );
}

export async function assign(taskId, userId) {
  return check(await supabase.from('task_assignees').insert({ task_id: taskId, user_id: userId }));
}

export async function unassign(taskId, userId) {
  return expectRows(
    await supabase.from('task_assignees').delete().match({ task_id: taskId, user_id: userId }).select(),
    'Only leads can remove other people from a task.',
  );
}

export async function addLink(taskId, label, url) {
  return check(await supabase.from('task_links').insert({ task_id: taskId, label, url }));
}

export async function removeLink(id) {
  return expectRows(
    await supabase.from('task_links').delete().eq('id', id).select('id'),
    'You can only remove links you added (leads can remove any).',
  );
}

export async function postMessage(taskId, body) {
  return check(await supabase.from('messages').insert({ task_id: taskId, body }).select().single());
}

export async function deleteMessage(id) {
  return expectRows(
    await supabase.from('messages').delete().eq('id', id).select('id'),
    'You can only delete your own messages (leads can delete any).',
  );
}

export async function renameSelf(userId, name) {
  return expectRows(
    await supabase.from('profiles').update({ name }).eq('id', userId).select(),
    'Could not update your name.',
  );
}
