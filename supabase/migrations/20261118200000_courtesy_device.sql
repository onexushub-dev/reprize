-- Courtesy for a recipient who opened the link signed out (docs/superpowers/specs/2026-11-16-recording-sharing-design.md,
-- §5.2). open-share registers such a phone by its device id; it becomes the account's only when the link is opened
-- again signed in, which is impossible once the link has expired. use_courtesy now takes the phone's id and moves that
-- row to the account before deciding, so downloading signed out and spending a courtesy later (day 2) works.
--
-- Knowing a share id and a device id is needed to claim a row: share ids are visible only to the owner and members.

drop function public.use_courtesy(uuid);

create function public.use_courtesy(p_share uuid, p_device text default null)
returns table (allowed boolean, used smallint, remaining smallint, reason text)
language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := auth.uid();
  v_owner uuid;
  v_used smallint;
  v_applied boolean;
begin
  if v_user is null then
    return query select false, 0::smallint, 0::smallint, 'sign_in'::text;
    return;
  end if;

  select s.owner into v_owner from public.shares s where s.id = p_share;
  if v_owner is null then
    return query select false, 0::smallint, 0::smallint, 'not_found'::text;
    return;
  end if;
  if v_owner = v_user then
    return query select false, 0::smallint, 0::smallint, 'own_share'::text;
    return;
  end if;

  insert into public.profiles (id) values (v_user) on conflict (id) do nothing;
  -- The row lock makes two taps at the same time count once.
  select p.courtesies_used into v_used from public.profiles p where p.id = v_user for update;

  -- This phone opened the link signed out: its row becomes the account's.
  if p_device is not null and char_length(p_device) <= 64
     and not exists (select 1 from public.share_members m where m.share_id = p_share and m.account = v_user) then
    update public.share_members m set account = v_user
      where m.share_id = p_share and m.device_id = p_device and m.account is null;
  end if;

  select m.courtesy_applied into v_applied
    from public.share_members m where m.share_id = p_share and m.account = v_user;
  if not found then
    return query select false, v_used, (3 - v_used)::smallint, 'not_member'::text;
    return;
  end if;
  if v_applied then
    return query select true, v_used, (3 - v_used)::smallint, 'already_applied'::text;
    return;
  end if;
  if v_used >= 3 then
    return query select false, v_used, 0::smallint, 'exhausted'::text;
    return;
  end if;

  update public.profiles p set courtesies_used = p.courtesies_used + 1 where p.id = v_user
    returning p.courtesies_used into v_used;
  update public.share_members m set courtesy_applied = true where m.share_id = p_share and m.account = v_user;
  return query select true, v_used, (3 - v_used)::smallint, 'applied'::text;
end;
$$;
revoke all on function public.use_courtesy(uuid, text) from public, anon;
grant execute on function public.use_courtesy(uuid, text) to authenticated;
