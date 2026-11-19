# Task Tree

A shared dependency tree for team tasks. Members sign in, see what's assigned to
them and what's ready to start, mark tasks complete, attach links, and discuss
each task in its own thread. There's also a team-wide channel.

**Stack:** React + Vite front end, [React Flow](https://reactflow.dev) for the
canvas, [Supabase](https://supabase.com) for the database, sign-in and live
updates. There's no server of your own to run: the site is static files, and
every rule is enforced in the database.

---

## Setup (about 30 minutes, once)

### 1. Create the Supabase project
1. Sign up at supabase.com and create a new project (the free tier is enough).
2. Open **SQL Editor** and run, in order:
   - `supabase/migrations/20261118000000_init.sql` (tables, rules, realtime)
   - `supabase/seed.sql` (optional: the hydrotest tasks from the prototype)
3. Still in the SQL editor, put yourself on the access list as an admin.
   **Do this before signing in**, or sign-in will be refused:
   ```sql
   insert into allowed_emails (email, role) values ('you@example.com', 'admin');
   ```
   Emails must be lowercase.

### 2. Turn on Google sign-in
1. In Google Cloud Console, create an OAuth client ID of type **Web application**.
2. Under **Authorized redirect URIs**, paste the callback URL shown on
   Supabase → **Authentication → Sign In / Providers → Google**
   (it looks like `https://<project-ref>.supabase.co/auth/v1/callback`).
3. Paste the Google client ID and secret into that Supabase page and enable it.
4. In Supabase → **Authentication → URL Configuration**, set **Site URL** to your
   live site, and add `http://localhost:5173` to **Redirect URLs** for local work.

Email sign-in links work out of the box as a fallback, but Supabase's built-in
email sender is heavily rate-limited, so treat Google as the main way in.
Set up custom SMTP later if you need email links for many people.

### 3. Run it locally
```bash
cp .env.example .env.local     # then fill in URL + publishable key
npm install
npm run dev                    # http://localhost:5173
```

### 4. Deploy
1. Push this folder to a GitHub repo.
2. Import it on Vercel, Netlify or Cloudflare Pages (framework: Vite, build:
   `npm run build`, output: `dist`).
3. Add the two `VITE_SUPABASE_*` environment variables in the host's settings.
4. Add the live URL to Supabase **Site URL** / **Redirect URLs** and to Google's
   **Authorized JavaScript origins**.

Every push to `main` then redeploys automatically.

---

## Managing the team

Run these in the Supabase SQL editor.

```sql
-- Let someone sign up
insert into allowed_emails (email, role) values ('name@example.com', 'member');

-- Promote to lead (do both: the access list for future sign-ups, the profile for now)
update allowed_emails set role = 'lead' where email = 'name@example.com';
update profiles       set role = 'lead' where email = 'name@example.com';

-- Remove someone's access (deletes their account; their tasks stay)
delete from allowed_emails where email = 'name@example.com';
delete from auth.users     where email = 'name@example.com';
```

## Who can do what

All enforced in the database, so they hold even if someone bypasses the site.

| Action | Member | Lead / admin |
|---|---|---|
| See tasks, links, discussions | ✓ | ✓ |
| Create, edit, move and connect tasks | ✓ | ✓ |
| Assign / unassign **themselves** | ✓ | ✓ |
| Assign / unassign **anyone** | | ✓ |
| Mark complete / reopen | If assigned, or if nobody is assigned | Always |
| Delete a task | | ✓ |
| Remove a link or message | Their own | Any |
| Manage the access list | | Admin only |

Other guarantees:
- Only emails on `allowed_emails` can create an account. Anyone else can't
  read anything, even with the site's key.
- Loops in the tree are refused (a task can't end up waiting on itself).
- Who completed a task, and when, is stamped by the server and can't be faked.
- Task numbers are never reused after a delete.
- Inserting a task on a line is one transaction: it can't half-happen.

---

## How to use it

- **Click a task** to open its panel: status, assignees, what it's waiting on,
  what it unlocks, links, details and its discussion thread.
- **↑ Next task / ↓ Prerequisite** next to the selected task add a connected task.
- **Drag from a task's top dot to another task's bottom dot** to say "the first
  must be done before the second". The arrow points to the task it unlocks.
- **Click a line** (or select a task) to show **+** (insert a task in the middle)
  and **×** (remove the dependency).
- **Ready / Blocked / Done** filters at the top-left highlight tasks by status.
  "Ready" means everything it waits on is done.
- **My tasks** lists your assigned work by status, plus unassigned tasks that
  are ready for someone to pick up.

---

## Project layout

```
supabase/
  migrations/…_init.sql   Tables, row-level security, triggers, RPCs, realtime
  seed.sql                Hydrotest starter tasks
  tests/schema.test.mjs   39 tests of every access rule (npm run test:db)
src/
  App.jsx                 Sign-in gate, views, shared state
  lib/
    supabase.js           Supabase client
    actions.js            Every database write, with readable errors
    graph.js              Status (ready/blocked/done), cycle check, auto-placement
    toast.jsx             Notifications
  hooks/
    useSession.js         Signed-in user
    useTeamData.js        Loads all data and keeps it live via Realtime
  components/
    TaskTree.jsx          React Flow canvas
    TaskNode.jsx          A task card
    DependencyEdge.jsx    A line with + / × buttons
    TaskPanel.jsx         Right-hand task panel
    Discussion.jsx        Live message thread (per task or team-wide)
    MyTasks.jsx           Personal view
    NewTaskDialog.jsx     Create / insert task
    Login.jsx, Header.jsx
```

## Changing the database

Write a new file in `supabase/migrations/` (never edit one that's already been
run), add a test to `supabase/tests/schema.test.mjs`, run `npm run test:db`,
then run the migration in the SQL editor.

Any new table must have row-level security turned on with policies, or it will
either be wide open or invisible. Copy the pattern from the existing tables.

## Ideas for next

- Activity history ("Bo completed Tank assembled") on each task
- Notifications when a task you're assigned to becomes ready
- Due dates, plus a "critical path" highlight on the longest chain
- Multiple trees (one per test campaign), each with its own canvas
- Link the "Test-readiness authorization" gate to the future SOP/checklist tool
