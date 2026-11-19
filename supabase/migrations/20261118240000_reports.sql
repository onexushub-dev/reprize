-- Reports (docs/superpowers/specs/2026-11-16-recording-sharing-design.md §8.3), decided 2026-11-18: a short list of
-- reasons, an optional text, and review in the Supabase dashboard (supabase/scripts/reports.sql).
--
-- A report takes the link down at once: open-share and share-page answer "removed" while a report is open or removed.
-- Reports come only through the report-share Edge Function, which limits how many one phone or browser files a day.

alter table public.reports
  add column category text not null default 'other'
    check (category in ('not_authorized', 'minor', 'inappropriate', 'other')),
  -- Who filed it, for the daily limit: "app:<device id>" or "web:<hash of the IP>". Never shown to the owner.
  add column reporter_key text check (char_length(reporter_key) <= 100),
  add column reviewed_at timestamptz;
-- The text is optional now (the reason is the category).
alter table public.reports alter column reason drop not null;
create index reports_share_idx on public.reports (share_id, state);
create index reports_reporter_idx on public.reports (reporter_key, created_at desc);

-- Filing goes through report-share only (its limit cannot be skipped from the app).
drop policy "reports: file as oneself" on public.reports;
revoke insert on public.reports from authenticated;
