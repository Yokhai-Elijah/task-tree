// Database tests: runs the migration + seed in an in-memory Postgres (PGlite) with
// Supabase's auth pieces stubbed, then checks every access rule.
// Run with: npm run test:db
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';

import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../..', import.meta.url));
const migration = readFileSync(`${root}/supabase/migrations/20261118000000_init.sql`, 'utf8');
const seed = readFileSync(`${root}/supabase/seed.sql`, 'utf8');

const db = new PGlite();

// Minimal stand-ins for what Supabase provides.
await db.exec(`
  create role anon nologin;
  create role authenticated nologin;
  create schema auth;
  create table auth.users (id uuid primary key default gen_random_uuid(), email text, raw_user_meta_data jsonb default '{}');
  create function auth.uid() returns uuid language sql stable as
    $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  grant usage on schema auth to authenticated, anon;
  grant execute on function auth.uid() to authenticated, anon;
  create publication supabase_realtime;
  grant usage on schema public to authenticated, anon;
  alter default privileges in schema public grant all on tables to authenticated, anon;
  alter default privileges in schema public grant all on sequences to authenticated, anon;
`);

await db.exec(migration);
await db.exec(seed);

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => { if (cond) { pass++; console.log('PASS', name); } else { fail++; console.log('FAIL', name, extra); } };

async function expectError(name, fn, match) {
  try { await fn(); ok(name, false, '(no error raised)'); }
  catch (e) { ok(name, !match || e.message.includes(match), e.message); }
}

// Run SQL as a signed-in user, inside a transaction, like PostgREST does.
async function as(userId, sql, params = []) {
  return db.transaction(async (tx) => {
    await tx.query(`select set_config('request.jwt.claim.sub', $1, true)`, [userId ?? '']);
    await tx.query('set local role authenticated');
    return tx.query(sql, params);
  });
}

// --- seed ---
const counts = (await db.query(`select (select count(*) from tasks) t, (select count(*) from dependencies) d`)).rows[0];
ok('seed: 12 tasks, 11 dependencies', Number(counts.t) === 12 && Number(counts.d) === 11, JSON.stringify(counts));

// --- sign-up gate ---
await db.exec(`insert into allowed_emails (email, role) values ('lead@example.com','lead'), ('a@example.com','member'), ('b@example.com','member')`);
await expectError('sign-up rejected when not on access list',
  () => db.query(`insert into auth.users (email) values ('stranger@gmail.com')`), 'access list');
const mk = async (email, name) => (await db.query(
  `insert into auth.users (email, raw_user_meta_data) values ($1, $2) returning id`, [email, { full_name: name }])).rows[0].id;
const lead = await mk('Lead@Example.com', 'Lena Lead');
const a = await mk('a@example.com', 'Alex');
const b = await mk('b@example.com', 'Bo');
const prof = (await db.query(`select name, role, email from profiles where id = $1`, [lead])).rows[0];
ok('profile created with role, name, lowercased email', prof.role === 'lead' && prof.name === 'Lena Lead' && prof.email === 'lead@example.com', JSON.stringify(prof));

// --- read access ---
ok('member can read tasks', (await as(a, 'select * from tasks')).rows.length === 12);
ok('signed-out user sees nothing', (await as(null, 'select * from tasks')).rows.length === 0);
const outsiderId = '00000000-0000-0000-0000-000000000001';
ok('authenticated non-member sees nothing', (await as(outsiderId, 'select * from tasks')).rows.length === 0);
await expectError('anon role has no table access', () => db.transaction(async (tx) => {
  await tx.query('set local role anon'); await tx.query('select * from tasks');
}), 'permission denied');

// --- create_task RPC ---
const id = (title) => db.query(`select id from tasks where title = $1`, [title]).then(r => Number(r.rows[0].id));
const tank = await id('Tank assembled');
const created = (await as(a, `select * from create_task('Leak check tank', 'task', 1000, 800, $1, null)`, [tank])).rows[0];
ok('create_task stamps creator', created.created_by === a);
const dep = await db.query(`select 1 from dependencies where prerequisite_id = $1 and dependent_id = $2`, [created.id, tank]);
ok('create_task wires prerequisite', dep.rows.length === 1);
await expectError('create_task rejects blank title', () => as(a, `select * from create_task('   ')`));

// --- cycles ---
const top = await id('Verification evidence accepted');
const bottom = await id('Waterloo pump suitability?');
await expectError('cycle refused (top -> bottom)',
  () => as(a, `insert into dependencies (prerequisite_id, dependent_id) values ($1, $2)`, [top, bottom]), 'loop');
await expectError('self dependency refused',
  () => as(a, `insert into dependencies (prerequisite_id, dependent_id) values ($1, $1)`, [top]), 'itself');
await expectError('duplicate dependency refused',
  () => as(a, `insert into dependencies (prerequisite_id, dependent_id) values ($1, $2)`, [created.id, tank]), 'duplicate');

// --- insert_task_between ---
const conduct = await id('Conduct hydrostatic test');
const mid = (await as(a, `select * from insert_task_between($1, $2, 'Fill and bleed', 'task', 570, 165)`, [conduct, top])).rows[0];
const chain = await db.query(`select prerequisite_id, dependent_id from dependencies where $1 in (prerequisite_id, dependent_id) or (prerequisite_id = $2 and dependent_id = $3)`, [mid.id, conduct, top]);
ok('insert_task_between rewires A -> new -> B', chain.rows.length === 2 && !chain.rows.some(r => Number(r.prerequisite_id) === conduct && Number(r.dependent_id) === top));
await expectError('insert_task_between on missing edge fails cleanly',
  () => as(a, `select * from insert_task_between($1, $2, 'X')`, [conduct, top]), 'no longer exists');
const orphan = await db.query(`select 1 from tasks where title = 'X'`);
ok('failed insert leaves no orphan task', orphan.rows.length === 0);

// --- completion rules ---
const software = await id('Software operational');
await as(a, `update tasks set completed_at = '2000-01-01' where id = $1`, [software]); // unassigned: anyone
const s1 = (await db.query(`select completed_at, completed_by from tasks where id = $1`, [software])).rows[0];
ok('unassigned task: any member can complete; server stamps time and person',
  s1.completed_by === a && new Date(s1.completed_at).getFullYear() > 2020, JSON.stringify(s1));

await as(b, `insert into task_assignees (task_id, user_id) values ($1, $2)`, [tank, b]);
await expectError('non-assignee cannot complete assigned task',
  () => as(a, `update tasks set completed_at = now() where id = $1`, [tank]), 'Only people assigned');
await as(b, `update tasks set completed_at = now() where id = $1`, [tank]);
ok('assignee can complete', (await db.query(`select completed_by from tasks where id = $1`, [tank])).rows[0].completed_by === b);
await as(lead, `update tasks set completed_at = null where id = $1`, [tank]);
ok('lead can reopen', (await db.query(`select completed_at, completed_by from tasks where id = $1`, [tank])).rows[0].completed_by === null);
await as(a, `update tasks set x = 1234, title = 'Tank assembled (welded)' where id = $1`, [tank]);
ok('non-assignee can still move/rename', Number((await db.query(`select x from tasks where id = $1`, [tank])).rows[0].x) === 1234);
await as(a, `update tasks set completed_by = $2 where id = $1`, [software, b]);
ok('completed_by cannot be forged', (await db.query(`select completed_by from tasks where id = $1`, [software])).rows[0].completed_by === a);

// --- assignment rules ---
await expectError('member cannot assign someone else',
  () => as(a, `insert into task_assignees (task_id, user_id) values ($1, $2)`, [software, b]), 'row-level security');
await as(lead, `insert into task_assignees (task_id, user_id) values ($1, $2)`, [software, a]);
ok('lead can assign anyone', (await db.query(`select 1 from task_assignees where task_id = $1 and user_id = $2`, [software, a])).rows.length === 1);
const r1 = await as(a, `delete from task_assignees where task_id = $1 and user_id = $2 returning *`, [tank, b]);
ok('member cannot unassign someone else', r1.rows.length === 0);

// --- deletes ---
const d1 = await as(a, `delete from tasks where id = $1 returning id`, [mid.id]);
ok('member cannot delete tasks', d1.rows.length === 0);
const d2 = await as(lead, `delete from tasks where id = $1 returning id`, [mid.id]);
ok('lead can delete tasks; edges cascade', d2.rows.length === 1 &&
  (await db.query(`select 1 from dependencies where $1 in (prerequisite_id, dependent_id)`, [mid.id])).rows.length === 0);

// --- links ---
await expectError('link must be http(s)',
  () => as(a, `insert into task_links (task_id, url) values ($1, 'javascript:alert(1)')`, [tank]), 'check constraint');
const link = (await as(a, `insert into task_links (task_id, label, url, added_by) values ($1, 'Drive', 'https://drive.google.com/x', $2) returning *`, [tank, b])).rows[0];
ok('link author forced to signed-in user', link.added_by === a);
ok('other member cannot delete your link', (await as(b, `delete from task_links where id = $1 returning id`, [link.id])).rows.length === 0);
ok('you can delete your link', (await as(a, `delete from task_links where id = $1 returning id`, [link.id])).rows.length === 1);

// --- messages ---
const msg = (await as(a, `insert into messages (task_id, body, author_id) values (null, 'hello team', $1) returning *`, [b])).rows[0];
ok('message author forced to signed-in user', msg.author_id === a);
await expectError('outsider cannot post', () => as(outsiderId, `insert into messages (body) values ('hi')`), 'row-level security');
ok('lead can delete any message', (await as(lead, `delete from messages where id = $1 returning id`, [msg.id])).rows.length === 1);

// --- profiles ---
await as(a, `update profiles set name = 'Alex K' where id = $1`, [a]);
ok('can rename self', (await db.query(`select name from profiles where id = $1`, [a])).rows[0].name === 'Alex K');
await expectError('cannot change own role', () => as(a, `update profiles set role = 'admin' where id = $1`, [a]), 'permission denied');
ok('cannot rename others', (await as(a, `update profiles set name = 'hacked' where id = $1 returning id`, [b])).rows.length === 0);
ok('member cannot read access list', (await as(a, `select * from allowed_emails`)).rows.length === 0);

// --- realtime publication ---
const pub = await db.query(`select tablename from pg_publication_tables where pubname = 'supabase_realtime' order by 1`);
ok('realtime publishes 6 tables', pub.rows.length === 6, JSON.stringify(pub.rows));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
