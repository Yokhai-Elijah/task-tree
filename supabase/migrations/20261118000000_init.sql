-- Task Tree: initial schema
-- Run once in the Supabase SQL editor (or `supabase db push` with the CLI).
--
-- Design notes
--   * Only emails on public.allowed_emails can sign up. Everyone else is rejected
--     at sign-up time by the trigger on auth.users.
--   * Every rule that matters is enforced here with row-level security (RLS) and
--     triggers, not just in the browser, because the browser can be bypassed.
--   * Dependencies point from prerequisite -> dependent task. Cycles are refused.

-- ============================================================================
-- Access list and profiles
-- ============================================================================

create table public.allowed_emails (
  email      text primary key check (email = lower(email)),
  role       text not null default 'member' check (role in ('member', 'lead', 'admin')),
  added_at   timestamptz not null default now()
);

comment on table public.allowed_emails is
  'Who may sign up. Add a row here before inviting someone. Emails must be lowercase.';

create table public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  email       text not null unique,
  name        text not null check (char_length(name) between 1 and 80),
  role        text not null default 'member' check (role in ('member', 'lead', 'admin')),
  created_at  timestamptz not null default now()
);

-- Create a profile when someone signs up, or reject the sign-up if their email
-- is not on the access list.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  allowed_role text;
begin
  select role into allowed_role
  from public.allowed_emails
  where email = lower(new.email);

  if allowed_role is null then
    raise exception 'This email is not on the team access list';
  end if;

  insert into public.profiles (id, email, name, role)
  values (
    new.id,
    lower(new.email),
    left(coalesce(
      nullif(new.raw_user_meta_data ->> 'full_name', ''),
      nullif(new.raw_user_meta_data ->> 'name', ''),
      split_part(new.email, '@', 1)
    ), 80),
    allowed_role
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Role helpers used by the policies below. SECURITY DEFINER so they can read
-- profiles without recursing through profiles' own policies.
create or replace function public.is_member()
returns boolean language sql stable security definer set search_path = public
as $$ select exists (select 1 from public.profiles where id = auth.uid()) $$;

create or replace function public.is_lead()
returns boolean language sql stable security definer set search_path = public
as $$ select exists (select 1 from public.profiles where id = auth.uid() and role in ('lead', 'admin')) $$;

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public
as $$ select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin') $$;

-- ============================================================================
-- Tasks and dependencies
-- ============================================================================

create table public.tasks (
  id            bigint generated always as identity primary key,  -- never reused
  title         text not null check (char_length(btrim(title)) between 1 and 140),
  description   text not null default '' check (char_length(description) <= 4000),
  type          text not null default 'task' check (type in ('task', 'uncertainty', 'milestone', 'safety')),
  workstream    text not null default '' check (char_length(workstream) <= 60),
  x             double precision not null default 0,
  y             double precision not null default 0,
  completed_at  timestamptz,
  completed_by  uuid references public.profiles (id) on delete set null,
  created_by    uuid references public.profiles (id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create table public.dependencies (
  prerequisite_id  bigint not null references public.tasks (id) on delete cascade,
  dependent_id     bigint not null references public.tasks (id) on delete cascade,
  created_at       timestamptz not null default now(),
  primary key (prerequisite_id, dependent_id),
  constraint no_self_dependency check (prerequisite_id <> dependent_id)
);

create index dependencies_dependent_idx on public.dependencies (dependent_id);

create table public.task_assignees (
  task_id   bigint not null references public.tasks (id) on delete cascade,
  user_id   uuid not null references public.profiles (id) on delete cascade,
  assigned_at timestamptz not null default now(),
  primary key (task_id, user_id)
);

create index task_assignees_user_idx on public.task_assignees (user_id);

create table public.task_links (
  id          bigint generated always as identity primary key,
  task_id     bigint not null references public.tasks (id) on delete cascade,
  label       text not null default '' check (char_length(label) <= 120),
  url         text not null check (url ~* '^https?://' and char_length(url) <= 2000),
  added_by    uuid references public.profiles (id) on delete set null default auth.uid(),
  created_at  timestamptz not null default now()
);

create index task_links_task_idx on public.task_links (task_id);

-- One table for both task threads (task_id set) and the team channel (task_id null).
create table public.messages (
  id          bigint generated always as identity primary key,
  task_id     bigint references public.tasks (id) on delete cascade,
  author_id   uuid references public.profiles (id) on delete set null default auth.uid(),
  body        text not null check (char_length(btrim(body)) between 1 and 4000),
  created_at  timestamptz not null default now()
);

create index messages_task_idx on public.messages (task_id, created_at);

-- ---------------------------------------------------------------------------
-- Task triggers: who created it, who completed it, and who may complete it
-- ---------------------------------------------------------------------------

create or replace function public.tasks_before_insert()
returns trigger language plpgsql
as $$
begin
  new.created_by   := auth.uid();
  new.created_at   := now();
  new.updated_at   := now();
  new.completed_at := null;
  new.completed_by := null;
  return new;
end;
$$;

create trigger tasks_before_insert
  before insert on public.tasks
  for each row execute function public.tasks_before_insert();

-- Completion rule: a lead, an assignee, or anyone if the task has no assignees.
-- The server stamps the time and the person; clients can't fake either.
create or replace function public.tasks_before_update()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  new.updated_at := now();
  new.created_by := old.created_by;
  new.created_at := old.created_at;

  if (new.completed_at is null) is distinct from (old.completed_at is null) then
    if auth.uid() is not null
       and not public.is_lead()
       and exists (select 1 from public.task_assignees where task_id = new.id)
       and not exists (select 1 from public.task_assignees where task_id = new.id and user_id = auth.uid())
    then
      raise exception 'Only people assigned to this task, or a lead, can change whether it is complete';
    end if;

    if new.completed_at is not null then
      new.completed_at := now();
      new.completed_by := auth.uid();
    else
      new.completed_by := null;
    end if;
  else
    new.completed_at := old.completed_at;
    new.completed_by := old.completed_by;
  end if;

  return new;
end;
$$;

create trigger tasks_before_update
  before update on public.tasks
  for each row execute function public.tasks_before_update();

-- ---------------------------------------------------------------------------
-- Dependency trigger: refuse anything that would create a cycle
-- ---------------------------------------------------------------------------

create or replace function public.prevent_dependency_cycle()
returns trigger language plpgsql
as $$
begin
  if new.prerequisite_id = new.dependent_id then
    raise exception 'A task cannot depend on itself';
  end if;

  -- Serialise dependency inserts so two people can't each add half of a cycle
  -- at the same moment. Cheap at team scale.
  lock table public.dependencies in share row exclusive mode;

  if exists (
    with recursive downstream (id) as (
      select new.dependent_id
      union
      select d.dependent_id
      from public.dependencies d
      join downstream on d.prerequisite_id = downstream.id
    )
    select 1 from downstream where id = new.prerequisite_id
  ) then
    raise exception 'That dependency would create a loop: the prerequisite already depends on this task';
  end if;

  return new;
end;
$$;

create trigger dependencies_prevent_cycle
  before insert or update on public.dependencies
  for each row execute function public.prevent_dependency_cycle();

-- ---------------------------------------------------------------------------
-- Author fields are always the signed-in user
-- ---------------------------------------------------------------------------

create or replace function public.stamp_author()
returns trigger language plpgsql
as $$
begin
  if tg_table_name = 'messages' then
    new.author_id := auth.uid();
  elsif tg_table_name = 'task_links' then
    new.added_by := auth.uid();
  end if;
  new.created_at := now();
  return new;
end;
$$;

create trigger messages_stamp_author before insert on public.messages
  for each row execute function public.stamp_author();
create trigger task_links_stamp_author before insert on public.task_links
  for each row execute function public.stamp_author();

-- ============================================================================
-- Multi-step operations as single transactions (called from the app via RPC)
-- ============================================================================

-- Create a task, optionally wired as a prerequisite of one task and/or a
-- dependent of another. All or nothing.
create or replace function public.create_task(
  p_title           text,
  p_type            text default 'task',
  p_x               double precision default 0,
  p_y               double precision default 0,
  p_prerequisite_of bigint default null,  -- the new task must be done before this one
  p_dependent_of    bigint default null   -- the new task waits on this one
)
returns public.tasks
language plpgsql security invoker set search_path = public
as $$
declare
  t public.tasks;
begin
  insert into public.tasks (title, type, x, y)
  values (btrim(p_title), p_type, p_x, p_y)
  returning * into t;

  if p_prerequisite_of is not null then
    insert into public.dependencies (prerequisite_id, dependent_id) values (t.id, p_prerequisite_of);
  end if;
  if p_dependent_of is not null then
    insert into public.dependencies (prerequisite_id, dependent_id) values (p_dependent_of, t.id);
  end if;

  return t;
end;
$$;

-- Replace the dependency A -> B with A -> new task -> B.
create or replace function public.insert_task_between(
  p_prerequisite_id bigint,
  p_dependent_id    bigint,
  p_title           text,
  p_type            text default 'task',
  p_x               double precision default 0,
  p_y               double precision default 0
)
returns public.tasks
language plpgsql security invoker set search_path = public
as $$
declare
  t public.tasks;
begin
  delete from public.dependencies
  where prerequisite_id = p_prerequisite_id and dependent_id = p_dependent_id;
  if not found then
    raise exception 'That dependency no longer exists. Someone may have just changed it.';
  end if;

  insert into public.tasks (title, type, x, y)
  values (btrim(p_title), p_type, p_x, p_y)
  returning * into t;

  insert into public.dependencies (prerequisite_id, dependent_id)
  values (p_prerequisite_id, t.id), (t.id, p_dependent_id);

  return t;
end;
$$;

-- ============================================================================
-- Row-level security
-- ============================================================================

alter table public.allowed_emails  enable row level security;
alter table public.profiles        enable row level security;
alter table public.tasks           enable row level security;
alter table public.dependencies    enable row level security;
alter table public.task_assignees  enable row level security;
alter table public.task_links      enable row level security;
alter table public.messages        enable row level security;

-- Access list: admins only.
create policy "admins manage access list" on public.allowed_emails
  for all to authenticated using (public.is_admin()) with check (public.is_admin());
-- Table access for signed-in users. Some newer Supabase projects don't grant
-- this automatically. The policies below still decide what each person can do.
grant usage on schema public to authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant usage, select on all sequences in schema public to authenticated;
grant execute on all functions in schema public to authenticated;
-- Profiles: members see the team; you can rename yourself (roles change via SQL).
create policy "members read profiles" on public.profiles
  for select to authenticated using (public.is_member());
create policy "edit own profile" on public.profiles
  for update to authenticated using (id = auth.uid()) with check (id = auth.uid());
revoke update on public.profiles from authenticated, anon;
grant update (name) on public.profiles to authenticated;

-- Tasks: members read, create and edit; only leads delete.
create policy "members read tasks" on public.tasks
  for select to authenticated using (public.is_member());
create policy "members create tasks" on public.tasks
  for insert to authenticated with check (public.is_member());
create policy "members edit tasks" on public.tasks
  for update to authenticated using (public.is_member()) with check (public.is_member());
create policy "leads delete tasks" on public.tasks
  for delete to authenticated using (public.is_lead());

-- Dependencies: members read, add and remove.
create policy "members read dependencies" on public.dependencies
  for select to authenticated using (public.is_member());
create policy "members add dependencies" on public.dependencies
  for insert to authenticated with check (public.is_member());
create policy "members remove dependencies" on public.dependencies
  for delete to authenticated using (public.is_member());

-- Assignees: anyone can take or drop a task for themselves; leads assign anyone.
create policy "members read assignees" on public.task_assignees
  for select to authenticated using (public.is_member());
create policy "assign self or lead assigns" on public.task_assignees
  for insert to authenticated
  with check (public.is_member() and (user_id = auth.uid() or public.is_lead()));
create policy "unassign self or lead unassigns" on public.task_assignees
  for delete to authenticated
  using (public.is_member() and (user_id = auth.uid() or public.is_lead()));

-- Links: members read and add; remove your own, or any if you're a lead.
create policy "members read links" on public.task_links
  for select to authenticated using (public.is_member());
create policy "members add links" on public.task_links
  for insert to authenticated with check (public.is_member());
create policy "remove own links or lead" on public.task_links
  for delete to authenticated using (added_by = auth.uid() or public.is_lead());

-- Messages: members read and post; delete your own, or any if you're a lead.
create policy "members read messages" on public.messages
  for select to authenticated using (public.is_member());
create policy "members post messages" on public.messages
  for insert to authenticated with check (public.is_member());
create policy "delete own messages or lead" on public.messages
  for delete to authenticated using (author_id = auth.uid() or public.is_lead());

-- Nobody outside the team gets anything, even read access.
revoke all on all tables in schema public from anon;

-- ============================================================================
-- Realtime: push changes to every open browser
-- ============================================================================

alter publication supabase_realtime add table
  public.tasks,
  public.dependencies,
  public.task_assignees,
  public.task_links,
  public.messages,
  public.profiles;
