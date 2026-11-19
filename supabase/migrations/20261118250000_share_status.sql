-- What the owner of a link sees on its share sheet (docs/superpowers/specs/2026-11-16-recording-sharing-design.md §3.1
-- step 5, §8.3): how many phones opened it and whether it was reported. Only counts and a state: the reports' reasons
-- and who filed them stay hidden from the owner.

create function public.share_status(p_share uuid)
returns table (opened integer, report text)
language sql stable security definer set search_path = '' as $$
  select
    (select count(*)::integer from public.share_members m where m.share_id = s.id),
    case
      when exists (select 1 from public.reports r where r.share_id = s.id and r.state = 'removed') then 'removed'
      when exists (select 1 from public.reports r where r.share_id = s.id and r.state = 'open') then 'open'
      else 'none'
    end
  from public.shares s
  where s.id = p_share and s.owner = (select auth.uid());
$$;
revoke all on function public.share_status(uuid) from public, anon;
grant execute on function public.share_status(uuid) to authenticated;
