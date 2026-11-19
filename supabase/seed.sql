-- Optional starter data: the tank hydrostatic verification workstream from the
-- prototype. Run after the migration, in the Supabase SQL editor.
-- Prerequisites sit lower on the canvas; arrows point up to what they unlock.

insert into public.tasks (title, type, workstream, x, y) values
  ('Verification evidence accepted', 'milestone',   'Verification', 570,  90),
  ('Conduct hydrostatic test',       'task',        'Verification', 570, 240),
  ('Test-readiness authorization',   'safety',      'Verification', 570, 390),
  ('Move and assemble onsite',       'task',        'Integration',  570, 540),
  ('Test site confirmed',            'task',        'Facility',      80, 720),
  ('Software operational',           'task',        'Software',     326, 720),
  ('Test plumbing mounted',          'task',        'Plumbing',     814, 720),
  ('Tank assembled',                 'task',        'Tank',        1058, 720),
  ('Approved pressure source',       'task',        'Facility',      80, 870),
  ('Tube circularized',              'task',        'Tank',        1058, 870),
  ('Waterloo pump suitability?',     'uncertainty', 'Facility',      80, 1020),
  ('JLC bulkheads received',         'task',        'Tank',        1058, 1020);

insert into public.dependencies (prerequisite_id, dependent_id)
select p.id, d.id
from (values
  ('Waterloo pump suitability?',   'Approved pressure source'),
  ('Approved pressure source',     'Test site confirmed'),
  ('Test site confirmed',          'Move and assemble onsite'),
  ('Software operational',         'Move and assemble onsite'),
  ('Test plumbing mounted',        'Move and assemble onsite'),
  ('JLC bulkheads received',       'Tube circularized'),
  ('Tube circularized',            'Tank assembled'),
  ('Tank assembled',               'Move and assemble onsite'),
  ('Move and assemble onsite',     'Test-readiness authorization'),
  ('Test-readiness authorization', 'Conduct hydrostatic test'),
  ('Conduct hydrostatic test',     'Verification evidence accepted')
) as e (prerequisite, dependent)
join public.tasks p on p.title = e.prerequisite
join public.tasks d on d.title = e.dependent;

insert into public.messages (task_id, body)
select null, 'Welcome to the task tree. Use this channel for team-wide discussion; each task also has its own thread.';
