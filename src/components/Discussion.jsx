import { useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase.js';
import { deleteMessage, postMessage } from '../lib/actions.js';
import { useToast } from '../lib/toast.jsx';
import { initials } from '../lib/graph.js';

const PAGE = 200;

function when(iso) {
  const d = new Date(iso);
  const sameDay = d.toDateString() === new Date().toDateString();
  return sameDay
    ? d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
    : d.toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

/** A live message thread. taskId = null is the team channel. */
export default function Discussion({ taskId, profilesById, me }) {
  const toast = useToast();
  const [messages, setMessages] = useState(null);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const listRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    setMessages(null);

    let query = supabase.from('messages').select('*');
    query = taskId == null ? query.is('task_id', null) : query.eq('task_id', taskId);
    query
      .order('created_at', { ascending: false })
      .limit(PAGE)
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) toast(error.message, 'error');
        setMessages((data ?? []).reverse());
      });

    // Realtime can't filter on "task_id is null", so filter here.
    const belongs = (m) => (m.task_id ?? null) === (taskId ?? null);
    const channel = supabase
      .channel(`messages-${taskId ?? 'team'}-${Math.random().toString(36).slice(2)}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, ({ new: m }) => {
        if (!belongs(m)) return;
        setMessages((prev) => (prev && !prev.some((p) => p.id === m.id) ? [...prev, m] : prev));
      })
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'messages' }, ({ old }) => {
        setMessages((prev) => prev?.filter((p) => p.id !== old.id) ?? prev);
      })
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, [taskId, toast]);

  // Keep the newest message in view.
  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages?.length]);

  async function send(e) {
    e?.preventDefault();
    const body = text.trim();
    if (!body || sending) return;
    setSending(true);
    try {
      const m = await postMessage(taskId, body);
      setText('');
      setMessages((prev) => (prev && !prev.some((p) => p.id === m.id) ? [...prev, m] : prev));
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setSending(false);
    }
  }

  async function remove(m) {
    if (!window.confirm('Delete this message?')) return;
    try {
      await deleteMessage(m.id);
      setMessages((prev) => prev.filter((p) => p.id !== m.id));
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  const canDelete = (m) => m.author_id === me.id || me.role !== 'member';

  return (
    <div className="discussion">
      <div className="messages" ref={listRef}>
        {messages === null && <p className="muted small">Loading…</p>}
        {messages?.length === 0 && (
          <p className="empty-note">No messages yet. Ask a question, share findings, or record a decision.</p>
        )}
        {messages?.map((m) => {
          const author = profilesById.get(m.author_id);
          return (
            <article key={m.id} className={`message ${m.author_id === me.id ? 'mine' : ''}`}>
              <span className="avatar" aria-hidden>
                {initials(author?.name ?? '?')}
              </span>
              <div className="message-body">
                <div className="message-meta">
                  <strong>{author?.name ?? 'Former member'}</strong>
                  <span className="muted">{when(m.created_at)}</span>
                  {canDelete(m) && (
                    <button className="icon-button" title="Delete message" onClick={() => remove(m)}>
                      ×
                    </button>
                  )}
                </div>
                <div className="message-text">{m.body}</div>
              </div>
            </article>
          );
        })}
      </div>
      <form className="compose" onSubmit={send}>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
          maxLength={4000}
          placeholder="Write a message… (Enter to send, Shift+Enter for a new line)"
          aria-label="New message"
        />
        <button type="submit" className="primary" disabled={sending || !text.trim()}>
          Send
        </button>
      </form>
    </div>
  );
}
