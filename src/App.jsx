import { useCallback, useMemo, useState } from 'react';
import { ReactFlowProvider } from '@xyflow/react';
import { isConfigured, supabase } from './lib/supabase.js';
import { useSession } from './hooks/useSession.js';
import { useTeamData } from './hooks/useTeamData.js';
import { useToast } from './lib/toast.jsx';
import { analyse } from './lib/graph.js';
import Login from './components/Login.jsx';
import Header from './components/Header.jsx';
import TaskTree from './components/TaskTree.jsx';
import TaskPanel from './components/TaskPanel.jsx';
import MyTasks from './components/MyTasks.jsx';
import Discussion from './components/Discussion.jsx';
import NewTaskDialog from './components/NewTaskDialog.jsx';

export default function App() {
  if (!isConfigured) {
    return (
      <div className="center-screen">
        <div className="card">
          <h1>Almost there</h1>
          <p>
            Copy <code>.env.example</code> to <code>.env.local</code>, fill in your Supabase URL and publishable key,
            then restart <code>npm run dev</code>.
          </p>
        </div>
      </div>
    );
  }
  return <SignedInGate />;
}

function SignedInGate() {
  const session = useSession();
  if (session === undefined) return <div className="center-screen muted">Loading…</div>;
  if (!session) return <Login />;
  return <Workspace session={session} />;
}

function Workspace({ session }) {
  const { data, error, refresh } = useTeamData(true);
  const toast = useToast();
  const [view, setView] = useState('tree');
  const [selectedId, setSelectedId] = useState(null);
  const [newTaskContext, setNewTaskContext] = useState(null);
  const [focus, setFocus] = useState(null); // { id, token } asks the canvas to centre on a task

  const analysis = useMemo(
    () => (data ? analyse(data.tasks, data.dependencies) : new Map()),
    [data],
  );
  const profilesById = useMemo(() => new Map((data?.profiles ?? []).map((p) => [p.id, p])), [data]);

  /** Run a database action, show a toast, and refresh so the UI updates immediately. */
  const run = useCallback(
    async (fn, successMessage) => {
      try {
        const result = await fn();
        if (successMessage) toast(successMessage);
        return result;
      } catch (e) {
        toast(e.message, 'error');
        return undefined;
      } finally {
        refresh();
      }
    },
    [refresh, toast],
  );

  const openTask = useCallback((id) => {
    setView('tree');
    setSelectedId(id);
    setFocus({ id, token: Date.now() });
  }, []);

  if (error && !data) {
    return (
      <div className="center-screen">
        <div className="card">
          <h1>Couldn't load the task tree</h1>
          <p className="muted">{error}</p>
          <button onClick={() => refresh()}>Try again</button>
        </div>
      </div>
    );
  }
  if (!data) return <div className="center-screen muted">Loading tasks…</div>;

  const me = profilesById.get(session.user.id);
  if (!me) {
    return (
      <div className="center-screen">
        <div className="card">
          <h1>No access yet</h1>
          <p className="muted">
            You're signed in as {session.user.email}, but that email isn't on the team's access list. Ask an admin to
            add you.
          </p>
          <button onClick={() => supabase.auth.signOut()}>Sign out</button>
        </div>
      </div>
    );
  }

  const selectedTask = data.tasks.find((t) => t.id === selectedId) ?? null;
  const myReadyCount = data.task_assignees.filter(
    (a) => a.user_id === me.id && analysis.get(a.task_id)?.status === 'ready',
  ).length;

  return (
    <div className="app">
      <Header me={me} view={view} onView={setView} myReadyCount={myReadyCount} run={run} />

      {view === 'tree' && (
        <div className={`tree-layout ${selectedTask ? 'with-panel' : ''}`}>
          <ReactFlowProvider>
            <TaskTree
              data={data}
              analysis={analysis}
              profilesById={profilesById}
              selectedId={selectedId}
              onSelect={setSelectedId}
              onNewTask={setNewTaskContext}
              focus={focus}
              run={run}
            />
          </ReactFlowProvider>
          {selectedTask && (
            <TaskPanel
              key={selectedTask.id}
              task={selectedTask}
              data={data}
              analysis={analysis}
              profilesById={profilesById}
              me={me}
              onSelect={openTask}
              onClose={() => setSelectedId(null)}
              onNewTask={setNewTaskContext}
              run={run}
            />
          )}
        </div>
      )}

      {view === 'mine' && (
        <MyTasks data={data} analysis={analysis} profilesById={profilesById} me={me} onOpen={openTask} run={run} />
      )}

      {view === 'chat' && (
        <main className="chat-page">
          <div className="chat-page-inner">
            <h1>Team channel</h1>
            <p className="muted">For anything that isn't about one task. Task discussions live on each task.</p>
            <Discussion taskId={null} profilesById={profilesById} me={me} />
          </div>
        </main>
      )}

      {newTaskContext && (
        <NewTaskDialog
          context={newTaskContext}
          data={data}
          onClose={() => setNewTaskContext(null)}
          onCreated={(task) => {
            setNewTaskContext(null);
            openTask(task.id);
          }}
          run={run}
        />
      )}
    </div>
  );
}
