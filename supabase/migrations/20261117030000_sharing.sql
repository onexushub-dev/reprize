-- Sharing recordings and clips by link: docs/superpowers/specs/2026-11-16-recording-sharing-design.md (§5.2, §5.5).
--
-- Who touches what:
-- * The app reads through row-level security (a share's owner and its members) and calls use_courtesy().
-- * Creating a share, opening it by link and writing clips go through Edge Functions with the service role (Phase 1).
-- * Files live in R2 under shares/<share id>/ (videos, thumbnails, focus files, the web cover); nothing here stores
--   their keys. expire-shares deletes that prefix when a share is turned off or 24 hours after it was created.
-- * The courtesy counter moves only through use_courtesy(): 3 per account, lifetime.

create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;

-- Tables ---------------------------------------------------------------------------------------------------------------

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text check (char_length(display_name) <= 60),
  instagram text check (instagram ~ '^[A-Za-z0-9._]{1,30}$'),
  courtesies_used smallint not null default 0 check (courtesies_used between 0 and 3),
  created_at timestamptz not null default now()
);

create table public.shares (
  id uuid primary key default gen_random_uuid(),
  owner uuid not null references auth.users (id) on delete cascade,
  kind text not null check (kind in ('recording', 'clip')),
  title text check (char_length(title) <= 80),
  sport text,
  -- SHA-256 of the 22-character link code; the code itself is never stored.
  token_hash bytea not null unique,
  clip_count smallint not null default 0 check (clip_count between 0 and 200),
  access text not null default 'link' check (access in ('link', 'restricted')),
  state text not null default 'active' check (state in ('active', 'off', 'expired')),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '24 hours',
  files_deleted_at timestamptz
);
create index shares_owner_idx on public.shares (owner, created_at desc);
create index shares_cleanup_idx on public.shares (expires_at) where files_deleted_at is null;

create table public.share_clips (
  id uuid primary key default gen_random_uuid(),
  share_id uuid not null references public.shares (id) on delete cascade,
  position smallint not null check (position >= 1),
  bytes bigint not null default 0,
  duration_ms integer,
  checksum text,
  -- Cut, zoom, rotation and speed as the sender left them.
  edit jsonb not null default '{}'::jsonb,
  has_focus boolean not null default false,
  has_ball boolean not null default false,
  upload_state text not null default 'pending' check (upload_state in ('pending', 'done', 'failed')),
  created_at timestamptz not null default now(),
  unique (share_id, position)
);

create table public.share_members (
  id uuid primary key default gen_random_uuid(),
  share_id uuid not null references public.shares (id) on delete cascade,
  -- Null until the person signs in; an app install that opened the link without an account is counted by device_id.
  account uuid references auth.users (id) on delete cascade,
  device_id text,
  joined_at timestamptz not null default now(),
  downloaded_at timestamptz,
  courtesy_applied boolean not null default false,
  check (account is not null or device_id is not null),
  unique (share_id, account),
  unique (share_id, device_id)
);
create index share_members_account_idx on public.share_members (account);

create table public.notice_acceptances (
  account uuid not null references auth.users (id) on delete cascade,
  version smallint not null,
  accepted_at timestamptz not null default now(),
  primary key (account, version)
);

create table public.reports (
  id uuid primary key default gen_random_uuid(),
  share_id uuid not null references public.shares (id) on delete cascade,
  reporter uuid references auth.users (id) on delete set null,
  reason text not null check (char_length(reason) between 1 and 500),
  state text not null default 'open' check (state in ('open', 'kept', 'removed')),
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;
alter table public.shares enable row level security;
alter table public.share_clips enable row level security;
alter table public.share_members enable row level security;
alter table public.notice_acceptances enable row level security;
alter table public.reports enable row level security;

-- Helpers for the policies (security definer: a policy on share_members that reads share_members would recurse) -----

create function public.is_share_owner(p_share uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.shares s where s.id = p_share and s.owner = (select auth.uid()));
$$;

create function public.is_share_member(p_share uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.share_members m where m.share_id = p_share and m.account = (select auth.uid())
  );
$$;

revoke all on function public.is_share_owner(uuid) from public, anon;
revoke all on function public.is_share_member(uuid) from public, anon;
grant execute on function public.is_share_owner(uuid) to authenticated;
grant execute on function public.is_share_member(uuid) to authenticated;

-- Policies and grants (new tables are not exposed by default: every grant below is deliberate) ----------------------

create policy "own profile: read" on public.profiles
  for select to authenticated using (id = (select auth.uid()));
create policy "own profile: edit" on public.profiles
  for update to authenticated using (id = (select auth.uid())) with check (id = (select auth.uid()));
grant select on public.profiles to authenticated;
-- The counter is left out on purpose: only use_courtesy() moves it.
grant update (display_name, instagram) on public.profiles to authenticated;

create policy "shares: owner or member reads" on public.shares
  for select to authenticated using (owner = (select auth.uid()) or public.is_share_member(id));
-- token_hash is left out on purpose.
grant select (id, owner, kind, title, sport, clip_count, access, state, created_at, expires_at, files_deleted_at)
  on public.shares to authenticated;

create policy "share clips: owner or member reads" on public.share_clips
  for select to authenticated using (public.is_share_owner(share_id) or public.is_share_member(share_id));
grant select on public.share_clips to authenticated;

create policy "share members: self or the share's owner reads" on public.share_members
  for select to authenticated using (account = (select auth.uid()) or public.is_share_owner(share_id));
grant select on public.share_members to authenticated;

create policy "notice: own acceptances" on public.notice_acceptances
  for select to authenticated using (account = (select auth.uid()));
create policy "notice: accept for oneself" on public.notice_acceptances
  for insert to authenticated with check (account = (select auth.uid()));
grant select, insert on public.notice_acceptances to authenticated;

create policy "reports: file as oneself" on public.reports
  for insert to authenticated with check (reporter = (select auth.uid()));
grant insert (share_id, reporter, reason) on public.reports to authenticated;

-- The Edge Functions (service role: creating shares, opening links, cleanup) read and write every table. With new
-- tables not exposed by default, the service role gets no rights unless granted here.
grant select, insert, update, delete
  on public.profiles, public.shares, public.share_clips, public.share_members, public.notice_acceptances, public.reports
  to service_role;

-- A profile for every new account ------------------------------------------------------------------------------------

create function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id) values (new.id) on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Courtesies ---------------------------------------------------------------------------------------------------------

-- Spends one of the 3 lifetime courtesies on a received share, once per share: a share that already has one costs
-- nothing more. Works after the link expired (the files are on the phone by then). The app calls it only for a free
-- user; PRO is decided by RevenueCat, not here.
-- reason: applied | already_applied | exhausted | not_member | own_share | not_found | sign_in
create function public.use_courtesy(p_share uuid)
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

revoke all on function public.use_courtesy(uuid) from public, anon;
grant execute on function public.use_courtesy(uuid) to authenticated;

-- Cleanup (called by the expire-shares Edge Function with the service role) -----------------------------------------

-- Shares whose files must leave R2: turned off, or past their 24 hours.
create function public.shares_to_clean(p_limit integer default 50)
returns setof uuid
language sql stable set search_path = '' as $$
  select s.id from public.shares s
  where s.files_deleted_at is null and (s.state = 'off' or s.expires_at <= now())
  order by s.expires_at
  limit p_limit;
$$;

-- Marks these shares' files as deleted; an active share past its time becomes expired.
create function public.mark_shares_cleaned(p_ids uuid[])
returns void
language sql set search_path = '' as $$
  update public.shares s
  set files_deleted_at = now(),
      state = case when s.state = 'active' then 'expired' else s.state end
  where s.id = any (p_ids);
$$;

revoke all on function public.shares_to_clean(integer) from public, anon, authenticated;
revoke all on function public.mark_shares_cleaned(uuid[]) from public, anon, authenticated;
grant execute on function public.shares_to_clean(integer) to service_role;
grant execute on function public.mark_shares_cleaned(uuid[]) to service_role;

-- Every 10 minutes, pg_cron calls expire-shares. The URL and the key live in Vault, created once by hand (never in
-- the repository): vault.create_secret('<project url>', 'project_url') and vault.create_secret('<key>', 'cron_key'),
-- with the same key as the function's CRON_KEY secret.
select cron.schedule(
  'expire-shares',
  '*/10 * * * *',
  $cron$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url') || '/functions/v1/expire-shares',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-key', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_key')
    ),
    body := '{}'::jsonb
  );
  $cron$
);
