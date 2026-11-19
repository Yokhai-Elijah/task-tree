import { supabase } from '../lib/supabase.js';
import { renameSelf } from '../lib/actions.js';

export default function Header({ me, view, onView, myReadyCount, run }) {
  const tabs = [
    ['tree', 'Task tree'],
    ['mine', 'My tasks', myReadyCount],
    ['chat', 'Team channel'],
  ];

  function rename() {
    const name = window.prompt('Your display name', me.name)?.trim();
    if (name && name !== me.name) run(() => renameSelf(me.id, name), 'Name updated.');
  }

  return (
    <header className="app-header">
      <div className="logo">
        ▲ TASK <span>TREE</span>
      </div>
      <nav className="tabs" aria-label="Views">
        {tabs.map(([id, label, badge]) => (
          <button
            key={id}
            className={`tab ${view === id ? 'active' : ''}`}
            aria-current={view === id ? 'page' : undefined}
            onClick={() => onView(id)}
          >
            {label}
            {badge > 0 && <span className="badge">{badge}</span>}
          </button>
        ))}
      </nav>
      <div className="me">
        <button className="link-button" onClick={rename} title="Change your display name">
          {me.name}
        </button>
        {me.role !== 'member' && <span className="role-chip">{me.role}</span>}
        <button onClick={() => supabase.auth.signOut()}>Sign out</button>
      </div>
    </header>
  );
}
