-- Several recordings behind one link (docs/superpowers/specs/2026-11-22-multi-recording-share-design.md §4).
--
-- A group is a share of kind 'group' that owns the link code; each recording in it is a normal 'recording' share
-- pointing at the group (group_id), with no code of its own, so it can only be reached through the group's code.
-- Expiry, turning off, cleanup, reports, members and courtesies keep working per share as before.

alter table public.shares drop constraint shares_kind_check;
alter table public.shares add constraint shares_kind_check check (kind in ('recording', 'clip', 'group'));

alter table public.shares
  add column group_id uuid references public.shares (id) on delete cascade,
  -- A recording's place in its group (1 to 10), the order the sender picked: one transaction stamps every row with
  -- the same created_at, so it cannot order them.
  add column group_position smallint check (group_position between 1 and 10),
  -- On a group: how many recordings it holds.
  add column recording_count smallint check (recording_count between 2 and 10),
  -- The clips' bytes summed (a recording in a group; its group): shown before the recipient downloads.
  add column total_bytes bigint check (total_bytes >= 0);

-- Only standalone links and groups have a code.
alter table public.shares alter column token_hash drop not null;
alter table public.shares add constraint shares_code_check check ((group_id is null) = (token_hash is not null));
-- A group is never inside another, and only recordings go in a group.
alter table public.shares add constraint shares_group_kind_check
  check ((kind <> 'group' or group_id is null) and (group_id is null or kind = 'recording'));
-- A group counts the clips of all its recordings (create-share allows at most 600 per group).
alter table public.shares drop constraint shares_clip_count_check;
alter table public.shares add constraint shares_clip_count_check check (clip_count between 0 and 600);

alter table public.shares add constraint shares_group_position_pair_check check ((group_id is null) = (group_position is null));
create unique index shares_group_idx on public.shares (group_id, group_position) where group_id is not null;

-- Whether the sender's phone sends the clip's thumbnail: a recipient sees the clips before choosing to download.
alter table public.share_clips add column has_thumb boolean not null default false;

grant select (group_id, group_position, recording_count, total_bytes) on public.shares to authenticated;

-- Creates a group, its recordings and their clips in one transaction (the Edge Function checked the body, the notice,
-- the rate limit and PRO; it makes the code and keeps only its hash). Recordings keep the order given.
-- p_recordings: [{ title, sport, recordedMs, clips: [{ position, bytes, durationMs, checksum, edit, hasThumb,
-- hasFocus, hasBall }] }]
-- Answers { "group": <uuid>, "recordings": [<uuid>, …] }.
create function public.create_share_group(
  p_owner uuid,
  p_token_hash bytea,
  p_expires_at timestamptz,
  p_recordings jsonb
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_count integer := jsonb_array_length(p_recordings);
  v_group uuid;
  v_child uuid;
  v_children uuid[] := '{}';
  v_rec jsonb;
  v_clips integer := 0;
  v_bytes bigint := 0;
  v_rec_bytes bigint;
  v_position smallint := 0;
begin
  if v_count < 2 or v_count > 10 then
    raise exception 'create_share_group: % recordings', v_count;
  end if;

  insert into public.shares (owner, kind, token_hash, clip_count, recording_count, expires_at)
  values (p_owner, 'group', p_token_hash, 0, v_count, p_expires_at)
  returning id into v_group;

  for v_rec in select value from jsonb_array_elements(p_recordings) loop
    v_position := v_position + 1;
    select coalesce(sum((c ->> 'bytes')::bigint), 0) into v_rec_bytes from jsonb_array_elements(v_rec -> 'clips') c;
    insert into public.shares (owner, kind, title, sport, clip_count, recorded_ms, total_bytes, expires_at, group_id, group_position)
    values (
      p_owner,
      'recording',
      v_rec ->> 'title',
      v_rec ->> 'sport',
      jsonb_array_length(v_rec -> 'clips'),
      (v_rec ->> 'recordedMs')::integer,
      v_rec_bytes,
      p_expires_at,
      v_group,
      v_position
    )
    returning id into v_child;

    insert into public.share_clips (share_id, position, bytes, duration_ms, checksum, edit, has_thumb, has_focus, has_ball)
    select
      v_child,
      (c ->> 'position')::smallint,
      (c ->> 'bytes')::bigint,
      (c ->> 'durationMs')::integer,
      c ->> 'checksum',
      coalesce(c -> 'edit', '{}'::jsonb),
      coalesce((c ->> 'hasThumb')::boolean, false),
      coalesce((c ->> 'hasFocus')::boolean, false),
      coalesce((c ->> 'hasBall')::boolean, false)
    from jsonb_array_elements(v_rec -> 'clips') c;

    v_children := v_children || v_child;
    v_clips := v_clips + jsonb_array_length(v_rec -> 'clips');
    v_bytes := v_bytes + v_rec_bytes;
  end loop;

  update public.shares set clip_count = v_clips, total_bytes = v_bytes where id = v_group;
  return jsonb_build_object('group', v_group, 'recordings', to_jsonb(v_children));
end;
$$;

revoke all on function public.create_share_group(uuid, bytea, timestamptz, jsonb) from public, anon, authenticated;
grant execute on function public.create_share_group(uuid, bytea, timestamptz, jsonb) to service_role;
