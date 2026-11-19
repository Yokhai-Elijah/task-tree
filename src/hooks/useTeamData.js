import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase.js';

// Everything except messages is small enough to keep fully in memory.
// Messages are loaded per thread by <Discussion>.
const TABLES = ['tasks', 'dependencies', 'task_assignees', 'task_links', 'profiles'];

async function fetchTable(table) {
  const { data, error } = await supabase.from(table).select('*');
  if (error) throw error;
  return data;
}

/**
 * Loads the team's data and keeps it live. Any change made by anyone (seen via
 * Supabase Realtime) triggers a refetch of just the tables that changed.
 * Returns { data, error, refresh } where refresh(tables?) forces a reload.
 */
export function useTeamData(enabled) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const pending = useRef(new Set());
  const timer = useRef();
  const alive = useRef(true);

  const refresh = useCallback(async (tables = TABLES) => {
    try {
      const rows = await Promise.all(tables.map(fetchTable));
      if (!alive.current) return;
      setData((prev) => ({ ...(prev ?? {}), ...Object.fromEntries(tables.map((t, i) => [t, rows[i]])) }));
      setError(null);
    } catch (e) {
      if (alive.current) setError(e.message);
    }
  }, []);

  useEffect(() => {
    if (!enabled) return undefined;
    alive.current = true;
    refresh();

    // Batch bursts of changes (e.g. inserting a task rewires two edges) into one refetch.
    const queue = (table) => {
      pending.current.add(table);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        const tables = [...pending.current];
        pending.current.clear();
        refresh(tables);
      }, 120);
    };

    const channel = supabase.channel('team-data');
    for (const table of TABLES) {
      channel.on('postgres_changes', { event: '*', schema: 'public', table }, () => queue(table));
    }
    // If the connection drops and comes back, catch up on anything missed.
    channel.subscribe((status) => {
      if (status === 'SUBSCRIBED') refresh();
    });

    return () => {
      alive.current = false;
      clearTimeout(timer.current);
      supabase.removeChannel(channel);
    };
  }, [enabled, refresh]);

  return { data, error, refresh };
}
