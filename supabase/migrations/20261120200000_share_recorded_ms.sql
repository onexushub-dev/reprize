-- How long the shared recording ran on the sender's phone (ms), so the recipient sees its minutes as for one of their
-- own recordings (2026-11-20). Null for shares made before, and for single clips.
alter table public.shares
  add column recorded_ms integer check (recorded_ms between 0 and 86400000);
